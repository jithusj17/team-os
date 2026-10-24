import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  QUEUES,
  type SearchResponse,
  type Task,
} from '@team-os/shared';
import { EMBEDDING_DIMENSIONS } from '../src/infrastructure/db/schema.js';
import type { EmbeddingProvider } from '../src/modules/search/domain/ports.js';
import {
  buildTestApp,
  ok,
  resetState,
  setupProject,
  type TestApp,
  type TestUser,
} from './helpers.js';

/**
 * Deterministic embeddings: each word (after a small synonym map) lights up one dimension,
 * so "money" and "billing" land close together without any keyword overlap.
 */
class FakeEmbeddings implements EmbeddingProvider {
  enabled = true;
  minSimilarity = 0.2;
  fail = false;
  private synonyms: Record<string, string> = {
    money: 'billing',
    payments: 'billing',
    invoices: 'billing',
  };

  async embed(texts: string[]) {
    if (this.fail) throw new Error('provider down');
    return texts.map((text) => {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (const raw of text.toLowerCase().match(/[a-z]+/g) ?? []) {
        const word = this.synonyms[raw] ?? raw;
        let h = 0;
        for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % EMBEDDING_DIMENSIONS;
        v[h] = 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}

describe('search', () => {
  let app: TestApp;
  let ctx: Awaited<ReturnType<typeof setupProject>>;
  const embeddings = new FakeEmbeddings();

  beforeAll(async () => {
    app = await buildTestApp({}, { embeddings });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    embeddings.fail = false;
    await resetState(app);
    ctx = await setupProject(app);
  });

  /** Indexes everything that changed since the last call, like the worker would. */
  let indexedSeq = 0;
  async function indexAll() {
    const events = await app.container.uow.repos.events.listSince(
      ctx.workspace.id,
      indexedSeq,
      1000,
    );
    const { indexJobFor } = await import('../src/modules/search/application/search-use-cases.js');
    for (const e of events) {
      const job = indexJobFor(e);
      if (job) await app.container.search.indexSource.execute(job);
    }
    indexedSeq = events.at(-1)?.seq ?? indexedSeq;
  }
  beforeEach(() => {
    indexedSeq = 0;
  });

  const search = (user: TestUser, q: string, extra = '') =>
    ok<SearchResponse>(
      app,
      user,
      'GET',
      `/workspaces/${ctx.workspace.id}/search?q=${encodeURIComponent(q)}${extra}`,
    );
  const titles = async (user: TestUser, q: string) =>
    (await search(user, q)).results.map((r) => r.title);
  const task = (title: string, description = '') =>
    ok<Task>(app, ctx.owner, 'POST', `/projects/${ctx.project.id}/tasks`, { title, description });

  it('finds tasks, comments and docs by word prefixes, with highlights', async () => {
    const t = await task('Build billing settings page', 'Plans, payment methods and invoices.');
    await ok(app, ctx.owner, 'POST', `/tasks/${t.id}/comments`, {
      body: 'The billing API is live on staging',
    });
    await ok(app, ctx.owner, 'POST', `/workspaces/${ctx.workspace.id}/docs`, {
      title: 'Launch plan',
      body: '## Goal\nShip **billing** to everyone.',
    });
    await indexAll();

    const res = await search(ctx.member, 'bill sett');
    expect(res.results[0]).toMatchObject({ type: 'task', taskKey: 'ENG-1', id: t.id });
    // Snippets highlight matches in the body text.
    const invoices = await search(ctx.member, 'invoices');
    expect(invoices.results[0]!.snippet).toContain(`${HIGHLIGHT_START}invoices${HIGHLIGHT_END}`);

    const staging = await search(ctx.member, 'staging');
    expect(staging.results).toEqual([
      expect.objectContaining({ type: 'comment', taskId: t.id, taskKey: 'ENG-1' }),
    ]);
    const doc = (await search(ctx.member, 'ship')).results.find((r) => r.type === 'doc')!;
    // Markdown is stripped before indexing, so snippets read as text.
    expect(doc.snippet).toBe(`Goal\n${HIGHLIGHT_START}Ship${HIGHLIGHT_END} billing to everyone`);
  });

  it('never returns content the user cannot open', async () => {
    await task('Secret roadmap');
    await ok(app, ctx.owner, 'POST', `/workspaces/${ctx.workspace.id}/docs`, {
      title: 'Secret handbook',
    });
    const meeting = await ok(app, ctx.owner, 'POST', `/workspaces/${ctx.workspace.id}/meetings`, {
      title: 'Secret offsite',
      startsAt: new Date(Date.UTC(2026, 11, 1, 10)).toISOString(),
      endsAt: new Date(Date.UTC(2026, 11, 1, 11)).toISOString(),
    });
    await ok(app, ctx.owner, 'PATCH', `/projects/${ctx.project.id}`, { visibility: 'private' });
    await indexAll();

    expect((await titles(ctx.owner, 'secret')).sort()).toEqual([
      'ENG-1 Secret roadmap',
      'Secret handbook',
      'Secret offsite',
    ]);
    expect((await titles(ctx.member, 'secret')).sort()).toEqual([
      'Secret handbook',
      'Secret offsite',
    ]); // project now private
    expect(await titles(ctx.guest, 'secret')).toEqual([]); // guests don't see workspace-level content

    await ok(app, ctx.owner, 'PATCH', `/meetings/${meeting.id}`, {
      version: meeting.version,
      attendeeIds: [ctx.guest.id],
    });
    await indexAll();
    expect(await titles(ctx.guest, 'secret')).toEqual(['Secret offsite']); // invited attendees can
  });

  it('removes deleted tasks and their comments, and skips unchanged sources', async () => {
    const t = await task('Temporary task');
    await ok(app, ctx.owner, 'POST', `/tasks/${t.id}/comments`, { body: 'temporary comment' });
    await indexAll();
    expect(await titles(ctx.owner, 'temporary')).toHaveLength(2);

    const again = await app.container.search.indexSource.execute({
      kind: 'source',
      sourceType: 'task',
      sourceId: t.id,
    });
    expect(again).toBe('unchanged');

    await ok(app, ctx.owner, 'DELETE', `/tasks/${t.id}`, undefined, 204);
    await indexAll();
    expect(await titles(ctx.owner, 'temporary')).toEqual([]);
  });

  it('uses embeddings to find related content without shared words', async () => {
    await task('Billing settings page');
    await task('Dark mode polish');
    await indexAll();

    const res = await search(ctx.owner, 'money');
    expect(res.semantic).toBe(true);
    expect(res.results[0]?.title).toBe('ENG-1 Billing settings page');
  });

  it('falls back to keyword search when the embeddings provider fails', async () => {
    await task('Billing settings page');
    await indexAll();
    embeddings.fail = true;
    const res = await search(ctx.owner, 'billing');
    expect(res.semantic).toBe(false);
    expect(res.results.map((r) => r.title)).toEqual(['ENG-1 Billing settings page']);
  });

  it('filters by type', async () => {
    const t = await task('Alpha task');
    await ok(app, ctx.owner, 'POST', `/tasks/${t.id}/comments`, { body: 'alpha comment' });
    await indexAll();
    const res = await search(ctx.owner, 'alpha', '&types=comment');
    expect(res.results.map((r) => r.type)).toEqual(['comment']);
  });

  it('debounces bursts of re-index requests for the same source', async () => {
    const t = await task('Burst');
    const job = { kind: 'source' as const, sourceType: 'task' as const, sourceId: t.id };
    await Promise.all([1, 2, 3].map(() => app.container.jobs.indexForSearch(job)));
    const counts = await app.container.jobs
      .queue(QUEUES.searchIndex)
      .getJobCounts('delayed', 'waiting');
    expect((counts.delayed ?? 0) + (counts.waiting ?? 0)).toBe(1);
  });
});

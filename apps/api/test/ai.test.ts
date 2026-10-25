import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AiDraftAction,
  AiDraftProposal,
  AiProposal,
  AiStreamEvent,
  Meeting,
  Task,
} from '@team-os/shared';
import type { LanguageModel, ModelRequest } from '../src/modules/ai/domain/ports.js';
import { indexJobFor } from '../src/modules/search/application/search-use-cases.js';
import { unprocessable } from '../src/shared/domain/errors.js';
import {
  buildTestApp,
  ok,
  request,
  resetState,
  setupProject,
  type TestApp,
  type TestUser,
} from './helpers.js';

/** A scripted model that records every request it receives. */
class FakeModel implements LanguageModel {
  enabled = true;
  name = 'fake-model';
  requests: ModelRequest[] = [];
  chunks = ['Summary ', 'text.'];
  draft: AiDraftProposal = { summary: 'Nothing to do', actions: [] };
  decline = false;

  async *streamText(req: ModelRequest) {
    this.requests.push(req);
    for (const chunk of this.chunks) yield chunk;
    if (this.decline) throw unprocessable('ai_declined', 'The AI declined this request.');
  }

  async draftActions(req: ModelRequest) {
    this.requests.push(req);
    return this.draft;
  }
}

const draftAction = (a: Partial<AiDraftAction> & Pick<AiDraftAction, 'type'>): AiDraftAction => ({
  reason: 'Because the notes say so',
  projectKey: null,
  taskKey: null,
  title: null,
  description: null,
  priority: null,
  assignee: null,
  status: null,
  dueDate: null,
  comment: null,
  ...a,
});

/** Parses a Server-Sent Events body into its events. */
function parseEvents(body: string): AiStreamEvent[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as AiStreamEvent);
}
const textOf = (events: AiStreamEvent[]) =>
  events.map((e) => (e.type === 'delta' ? e.text : '')).join('');

describe('AI', () => {
  let app: TestApp;
  let ctx: Awaited<ReturnType<typeof setupProject>>;
  const model = new FakeModel();

  beforeAll(async () => {
    app = await buildTestApp({}, { model });
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    model.requests = [];
    model.chunks = ['Summary ', 'text.'];
    model.draft = { summary: 'Nothing to do', actions: [] };
    model.decline = false;
    await resetState(app);
    ctx = await setupProject(app);
  });

  const ws = () => `/workspaces/${ctx.workspace.id}`;
  const task = (title: string, extra: Record<string, unknown> = {}, projectId = ctx.project.id) =>
    ok<Task>(app, ctx.owner, 'POST', `/projects/${projectId}/tasks`, { title, ...extra });
  const privateProject = async () => {
    const p = await app.container.projects.create.execute(ctx.owner.id, ctx.workspace.id, {
      name: 'Secret',
      key: 'SEC',
      description: '',
      visibility: 'private',
    });
    return p;
  };
  const summarize = (user: TestUser, type: string, id: string) =>
    request(app, user, 'POST', '/ai/summaries', { type, id });

  describe('summaries', () => {
    it('streams a summary and caches it until the content changes', async () => {
      const t = await task('Migrate billing', { description: 'Move invoices to the new provider' });

      const first = await summarize(ctx.member, 'task', t.id);
      expect(first.statusCode).toBe(200);
      expect(first.headers['content-type']).toContain('text/event-stream');
      const events = parseEvents(first.body);
      expect(textOf(events)).toBe('Summary text.');
      expect(events.at(-1)).toEqual({ type: 'done', cached: false });
      expect(model.requests[0]!.prompt).toContain('Move invoices to the new provider');

      // Same content: served from the cache without calling the model.
      const second = parseEvents((await summarize(ctx.owner, 'task', t.id)).body);
      expect(textOf(second)).toBe('Summary text.');
      expect(second.at(-1)).toEqual({ type: 'done', cached: true });
      expect(model.requests).toHaveLength(1);

      // A new comment changes the content, so the summary is regenerated.
      await ok(app, ctx.owner, 'POST', `/tasks/${t.id}/comments`, { body: 'Provider signed' });
      const third = parseEvents((await summarize(ctx.member, 'task', t.id)).body);
      expect(third.at(-1)).toEqual({ type: 'done', cached: false });
      expect(model.requests[1]!.prompt).toContain('Provider signed');
    });

    it('summarizes projects, docs and meetings', async () => {
      await task('Overdue thing', { dueDate: '2020-01-01' });
      parseEvents((await summarize(ctx.member, 'project', ctx.project.id)).body);
      expect(model.requests[0]!.prompt).toMatch(/ENG-1 \[[^\]]+\] Overdue thing.*OVERDUE/);

      const doc = await ok(app, ctx.owner, 'POST', `${ws()}/docs`, {
        title: 'Handbook',
        body: '# Values\nShip it',
      });
      parseEvents((await summarize(ctx.member, 'doc', doc.id)).body);
      expect(model.requests[1]!.prompt).toContain('Ship it');

      const meeting = await ok<Meeting>(app, ctx.owner, 'POST', `${ws()}/meetings`, {
        title: 'Planning',
        startsAt: new Date(Date.UTC(2026, 11, 1, 10)).toISOString(),
        endsAt: new Date(Date.UTC(2026, 11, 1, 11)).toISOString(),
        attendeeIds: [ctx.member.id],
      });
      const { docId } = await ok(app, ctx.member, 'POST', `/meetings/${meeting.id}/notes`, {}, 200);
      await ok(app, ctx.member, 'PATCH', `/docs/${docId}`, {
        version: 1,
        body: 'Decided to launch in December',
      });
      parseEvents((await summarize(ctx.member, 'meeting', meeting.id)).body);
      expect(model.requests[2]!.prompt).toContain('Decided to launch in December');
      expect(model.requests[2]!.prompt).toContain('member user (pending)');
    });

    it('checks access before generating anything', async () => {
      const secret = await privateProject();
      const t = await task('Secret plan', {}, secret.id);

      for (const [user, type, id] of [
        [ctx.member, 'task', t.id],
        [ctx.member, 'project', secret.id],
        [ctx.outsider, 'project', ctx.project.id],
        [ctx.guest, 'project', ctx.project.id],
      ] as const) {
        const res = await summarize(user, type, id);
        expect(res.statusCode).toBe(404);
      }
      const doc = await ok(app, ctx.owner, 'POST', `${ws()}/docs`, { title: 'Members only' });
      expect((await summarize(ctx.guest, 'doc', doc.id)).statusCode).toBe(404);
      expect((await summarize(null as unknown as TestUser, 'doc', doc.id)).statusCode).toBe(401);
      expect(model.requests).toHaveLength(0);
    });

    it('reports a model failure mid-stream as an error event and caches nothing', async () => {
      const t = await task('Anything');
      model.decline = true;
      const events = parseEvents((await summarize(ctx.member, 'task', t.id)).body);
      expect(events.at(-1)).toEqual({
        type: 'error',
        code: 'ai_declined',
        message: 'The AI declined this request.',
      });
      model.decline = false;
      const retry = parseEvents((await summarize(ctx.member, 'task', t.id)).body);
      expect(retry.at(-1)).toEqual({ type: 'done', cached: false });
    });
  });

  describe('ask the workspace', () => {
    async function indexAll() {
      const events = await app.container.uow.repos.events.listSince(ctx.workspace.id, 0, 1000);
      for (const e of events) {
        const job = indexJobFor(e);
        if (job) await app.container.search.indexSource.execute(job);
      }
    }
    const ask = (user: TestUser, question: string) =>
      request(app, user, 'POST', `${ws()}/ai/ask`, { question });

    it('answers from permitted content only, with numbered sources', async () => {
      const visible = await task('Billing migration', { description: 'Due before launch' });
      const secret = await privateProject();
      await task('Billing layoffs plan', { description: 'Confidential' }, secret.id);
      await indexAll();

      model.chunks = ['The migration is due before launch [1].'];
      const res = await ask(ctx.member, 'What is happening with billing?');
      expect(res.statusCode).toBe(200);
      const events = parseEvents(res.body);
      const sources = events[0]!;
      expect(sources).toMatchObject({
        type: 'sources',
        sources: [{ n: 1, type: 'task', id: visible.id, taskKey: 'ENG-1' }],
      });
      expect(textOf(events)).toBe('The migration is due before launch [1].');
      // The private task never reaches the model.
      expect(model.requests[0]!.prompt).toContain('Due before launch');
      expect(model.requests[0]!.prompt).not.toContain('Confidential');

      // The owner can see both.
      model.requests = [];
      const ownerSources = parseEvents((await ask(ctx.owner, 'billing?')).body)[0];
      expect(ownerSources?.type === 'sources' && ownerSources.sources).toHaveLength(2);
    });

    it('says so without calling the model when nothing matches', async () => {
      const events = parseEvents((await ask(ctx.member, 'quarterly zebra forecast')).body);
      expect(events[0]).toEqual({ type: 'sources', sources: [] });
      expect(textOf(events)).toContain("couldn't find anything");
      expect(model.requests).toHaveLength(0);
    });

    it('rejects non-members', async () => {
      expect((await ask(ctx.outsider, 'billing?')).statusCode).toBe(404);
    });
  });

  describe('actions', () => {
    const propose = (user: TestUser, body: Record<string, unknown>) =>
      request(app, user, 'POST', `${ws()}/ai/proposals`, body);
    const execute = (user: TestUser, id: string, body: Record<string, unknown> = {}) =>
      request(app, user, 'POST', `/ai/proposals/${id}/execute`, body);
    const taskCount = async () =>
      (await ok(app, ctx.owner, 'GET', `/projects/${ctx.project.id}/tasks`)).items.length;

    it('resolves and validates proposed actions, then executes the confirmed ones once', async () => {
      const existing = await task('Write launch post');
      const secret = await privateProject();
      const hidden = await task('Hidden task', {}, secret.id);
      model.draft = {
        summary: 'Create one task, update one, comment on one',
        actions: [
          draftAction({
            type: 'create_task',
            title: 'Book venue',
            assignee: 'member',
            status: 'in progress',
            priority: 'high',
            dueDate: '2026-12-01',
          }),
          draftAction({ type: 'update_task', taskKey: 'eng-1', assignee: 'member@example.com' }),
          draftAction({ type: 'add_comment', taskKey: existing.key, comment: 'Draft is ready' }),
          draftAction({ type: 'create_task', projectKey: 'NOPE', title: 'Lost' }),
          draftAction({ type: 'add_comment', taskKey: hidden.key, comment: 'Peek' }),
          draftAction({ type: 'create_task', title: 'Bad date', dueDate: '2026-02-30' }),
          draftAction({ type: 'create_task', title: 'Nobody', assignee: 'Zed' }),
          draftAction({ type: 'update_task', taskKey: existing.key }),
        ],
      };

      const res = await propose(ctx.member, {
        instruction: 'Plan the launch',
        projectId: ctx.project.id,
      });
      expect(res.statusCode).toBe(201);
      const proposal = res.json<AiProposal>();
      expect(proposal.status).toBe('pending');
      const inProgress = ctx.status('In Progress');
      expect(proposal.actions[0]).toMatchObject({
        id: 1,
        error: null,
        projectKey: 'ENG',
        title: 'Book venue',
        assigneeId: ctx.member.id,
        statusId: inProgress.id,
        priority: 'high',
        dueDate: '2026-12-01',
      });
      expect(proposal.actions[1]).toMatchObject({
        error: null,
        taskId: existing.id,
        assigneeId: ctx.member.id,
      });
      expect(proposal.actions[2]).toMatchObject({ error: null, comment: 'Draft is ready' });
      expect(proposal.actions.slice(3).map((a) => a.error)).toEqual([
        'Project NOPE not found',
        `Task ${hidden.key} not found`,
        '"2026-02-30" is not a valid date',
        'No one called "Zed" can be assigned here',
        'Nothing to change',
      ]);
      // The model only saw projects and people from this workspace that the actor can use.
      expect(model.requests[0]!.prompt).toContain('ENG "Engineering"');
      expect(model.requests[0]!.prompt).not.toContain('SEC');

      // Nothing changed yet.
      expect(await taskCount()).toBe(1);

      // Only the proposer can see or run it.
      expect(
        (await request(app, ctx.owner, 'GET', `/ai/proposals/${proposal.id}`)).statusCode,
      ).toBe(404);
      expect((await execute(ctx.owner, proposal.id)).statusCode).toBe(404);

      // A double-clicked confirmation applies the actions once.
      const [a, b] = await Promise.all([
        execute(ctx.member, proposal.id),
        execute(ctx.member, proposal.id),
      ]);
      expect(a.statusCode).toBe(200);
      expect(b.json()).toEqual(a.json());
      const done = a.json<AiProposal>();
      expect(done.status).toBe('executed');
      expect(done.results).toEqual([
        { actionId: 1, ok: true, taskId: expect.any(String), taskKey: 'ENG-2', error: null },
        { actionId: 2, ok: true, taskId: existing.id, taskKey: 'ENG-1', error: null },
        { actionId: 3, ok: true, taskId: existing.id, taskKey: 'ENG-1', error: null },
      ]);
      expect(await taskCount()).toBe(2);

      const created = await ok<Task>(app, ctx.member, 'GET', `/tasks/${done.results![0]!.taskId}`);
      expect(created).toMatchObject({
        title: 'Book venue',
        assigneeId: ctx.member.id,
        statusId: inProgress.id,
        createdBy: ctx.member.id,
      });
      const updated = await ok<Task>(app, ctx.member, 'GET', `/tasks/${existing.id}`);
      expect(updated.assigneeId).toBe(ctx.member.id);
      const comments = await ok(app, ctx.member, 'GET', `/tasks/${existing.id}/comments`);
      expect(comments.map((c: { body: string }) => c.body)).toEqual(['Draft is ready']);

      // Executing again is a no-op that returns the recorded outcome.
      const again = await execute(ctx.member, proposal.id);
      expect(again.json()).toEqual(done);
      expect(await taskCount()).toBe(2);
    });

    it('runs only the selected actions', async () => {
      model.draft = {
        summary: 'Two tasks',
        actions: [
          draftAction({ type: 'create_task', title: 'One' }),
          draftAction({ type: 'create_task', title: 'Two' }),
        ],
      };
      const proposal = (
        await propose(ctx.member, { instruction: 'Two tasks', projectId: ctx.project.id })
      ).json<AiProposal>();
      const done = (await execute(ctx.member, proposal.id, { actionIds: [2] })).json<AiProposal>();
      expect(done.results!.map((r) => r.actionId)).toEqual([2]);
      expect(await taskCount()).toBe(1);

      const none = (
        await propose(ctx.member, { instruction: 'Two tasks', projectId: ctx.project.id })
      ).json<AiProposal>();
      const res = await execute(ctx.member, none.id, { actionIds: [] });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('no_actions_selected');
    });

    it("never lets the AI do what the user couldn't", async () => {
      // Guests get explicit viewer access: they can read the project but not create tasks.
      await ok(
        app,
        ctx.owner,
        'PUT',
        `/projects/${ctx.project.id}/members/${ctx.guest.id}`,
        { role: 'viewer' },
        204,
      );
      const t = await task('Read only');
      model.draft = {
        summary: 'Try everything',
        actions: [
          draftAction({ type: 'create_task', title: 'Sneaky' }),
          draftAction({ type: 'update_task', taskKey: t.key, title: 'Renamed' }),
          draftAction({ type: 'create_task', title: 'Assign outsider', assignee: 'Outsider' }),
        ],
      };
      const proposal = (
        await propose(ctx.guest, { instruction: 'Do it', projectId: ctx.project.id })
      ).json<AiProposal>();
      expect(proposal.actions.map((a) => a.error)).toEqual([
        "You can't create tasks in ENG",
        `You can't edit ${t.key}`,
        "You can't create tasks in ENG",
      ]);
      expect((await execute(ctx.guest, proposal.id)).statusCode).toBe(400);

      // Projects the actor can't see can't be the default target.
      const secret = await privateProject();
      expect(
        (await propose(ctx.member, { instruction: 'x x x', projectId: secret.id })).statusCode,
      ).toBe(404);
      expect((await propose(ctx.outsider, { instruction: 'x x x' })).statusCode).toBe(404);
    });

    it('re-checks permissions at execution time', async () => {
      model.draft = {
        summary: 'One task',
        actions: [draftAction({ type: 'create_task', title: 'Later' })],
      };
      const proposal = (
        await propose(ctx.member, { instruction: 'One task', projectId: ctx.project.id })
      ).json<AiProposal>();

      // The member loses edit rights before confirming.
      await ok(
        app,
        ctx.owner,
        'PUT',
        `/projects/${ctx.project.id}/members/${ctx.member.id}`,
        { role: 'viewer' },
        204,
      );
      const done = (await execute(ctx.member, proposal.id)).json<AiProposal>();
      expect(done.results).toEqual([
        expect.objectContaining({ actionId: 1, ok: false, error: expect.any(String) }),
      ]);
      expect(await taskCount()).toBe(0);
    });

    it('turns meeting notes into tasks', async () => {
      const meeting = await ok<Meeting>(app, ctx.owner, 'POST', `${ws()}/meetings`, {
        title: 'Launch sync',
        startsAt: new Date(Date.UTC(2026, 11, 1, 10)).toISOString(),
        endsAt: new Date(Date.UTC(2026, 11, 1, 11)).toISOString(),
        attendeeIds: [ctx.member.id],
      });
      const { docId } = await ok(app, ctx.member, 'POST', `/meetings/${meeting.id}/notes`, {}, 200);
      await ok(app, ctx.member, 'PATCH', `/docs/${docId}`, {
        version: 1,
        body: '## Action items\n- [ ] Member to send the press kit by Friday',
      });
      model.draft = {
        summary: 'One action item',
        actions: [
          draftAction({ type: 'create_task', title: 'Send the press kit', assignee: 'member' }),
        ],
      };
      const res = await propose(ctx.member, {
        instruction: 'Create tasks for the action items',
        projectId: ctx.project.id,
        source: { type: 'meeting', id: meeting.id },
      });
      expect(res.statusCode).toBe(201);
      expect(model.requests[0]!.prompt).toContain('send the press kit by Friday');
      expect(res.json<AiProposal>().actions[0]!.error).toBeNull();

      // Sources are read with the actor's permissions: guests can't use this meeting.
      const denied = await propose(ctx.guest, {
        instruction: 'Create tasks',
        source: { type: 'meeting', id: meeting.id },
      });
      expect(denied.statusCode).toBe(404);
    });
  });

  describe('without an API key', () => {
    let plain: TestApp;
    beforeAll(async () => {
      plain = await buildTestApp();
    });
    afterAll(() => plain.close());

    it('reports AI as disabled', async () => {
      const user = ctx.member;
      expect(await ok(plain, user, 'GET', '/ai/status')).toEqual({ enabled: false });
      const res = await request(plain, user, 'POST', '/ai/summaries', {
        type: 'project',
        id: ctx.project.id,
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('ai_not_configured');
    });
  });
});

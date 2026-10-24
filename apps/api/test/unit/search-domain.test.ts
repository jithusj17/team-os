import { describe, expect, it } from 'vitest';
import type { WorkspaceEvent } from '@team-os/shared';
import { indexJobFor } from '../../src/modules/search/application/search-use-cases.js';
import {
  chunkText,
  markdownToText,
  reciprocalRankFusion,
  stripMentions,
  toPrefixTsQuery,
} from '../../src/modules/search/domain/search.js';

describe('chunkText', () => {
  it('keeps short text whole and splits long text with overlap at boundaries', () => {
    expect(chunkText('  short text ')).toEqual(['short text']);
    const paragraphs = Array.from(
      { length: 12 },
      (_, i) => `Paragraph ${i} ${'word '.repeat(40)}`,
    ).join('\n\n');
    const chunks = chunkText(paragraphs, 600, 100);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 600)).toBe(true);
    // Every paragraph start survives somewhere.
    for (let i = 0; i < 12; i++)
      expect(chunks.some((c) => c.includes(`Paragraph ${i} `))).toBe(true);
  });
});

describe('toPrefixTsQuery', () => {
  it('builds a prefix query from words only', () => {
    expect(toPrefixTsQuery('Bill sett!')).toBe('bill:* & sett:*');
    expect(toPrefixTsQuery("O'Brien & co | (x)")).toBe('o:* & brien:* & co:* & x:*');
    expect(toPrefixTsQuery('!!! ---')).toBeNull();
  });
});

describe('reciprocalRankFusion', () => {
  it('rewards items found by both lists', () => {
    const fused = reciprocalRankFusion([
      [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
      [{ key: 'c' }, { key: 'd' }],
    ]);
    expect(fused[0]!.item.key).toBe('c');
    expect(fused.map((f) => f.item.key).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('markdownToText', () => {
  it('drops syntax but keeps words and identifiers', () => {
    const md =
      '# Plan\n\n- [x] **Ship** the `api`\n- see [docs](https://x.y)\n\n| a | b |\n| --- | --- |\n| snake_case | *em* |';
    expect(markdownToText(md)).toBe('Plan\n\nShip the api\nsee docs\n\n a b \n\n snake_case em');
  });

  it('removes mention tokens', () => {
    expect(stripMentions('hi <@11111111-1111-4111-8111-111111111111>!')).toBe('hi @!');
  });
});

describe('indexJobFor', () => {
  const event = (
    type: WorkspaceEvent['type'],
    extra: Partial<WorkspaceEvent> = {},
  ): WorkspaceEvent => ({
    workspaceId: 'w',
    seq: 1,
    type,
    projectId: 'p',
    taskId: 't',
    actorId: null,
    payload: { id: 'x' },
    createdAt: new Date(),
    ...extra,
  });
  it('maps events to the source to re-index', () => {
    expect(indexJobFor(event('task.updated'))).toEqual({
      kind: 'source',
      sourceType: 'task',
      sourceId: 't',
    });
    expect(indexJobFor(event('comment.deleted'))).toEqual({
      kind: 'source',
      sourceType: 'comment',
      sourceId: 'x',
    });
    expect(indexJobFor(event('doc.created'))).toEqual({
      kind: 'source',
      sourceType: 'doc',
      sourceId: 'x',
    });
    expect(indexJobFor(event('project.deleted'))).toEqual({
      kind: 'project-deleted',
      projectId: 'p',
    });
    expect(indexJobFor(event('label.changed'))).toBeNull();
  });
});

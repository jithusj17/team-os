import { describe, expect, it } from 'vitest';
import { parseMentions } from '../../src/modules/tasks/domain/comment.js';
import {
  SORT_GAP,
  diffTask,
  parseTaskKey,
  sortOrderBetween,
  type Task,
} from '../../src/modules/tasks/domain/task.js';
import { defaultStatus, type Status } from '../../src/modules/projects/domain/project.js';

describe('sortOrderBetween', () => {
  it('handles empty columns and both ends', () => {
    expect(sortOrderBetween(null, null)).toBe(0);
    expect(sortOrderBetween(null, 100)).toBe(100 - SORT_GAP);
    expect(sortOrderBetween(100, null)).toBe(100 + SORT_GAP);
  });

  it('takes the midpoint, and asks for a rebalance when there is no room', () => {
    expect(sortOrderBetween(1, 2)).toBe(1.5);
    expect(sortOrderBetween(1, 1 + 1e-9)).toBeNull();
  });

  it('survives many insertions at the same spot before needing a rebalance', () => {
    let after = 0;
    const before = SORT_GAP;
    let inserts = 0;
    for (
      let next = sortOrderBetween(after, before);
      next !== null;
      next = sortOrderBetween(after, before)
    ) {
      after = next;
      inserts++;
    }
    expect(inserts).toBeGreaterThan(25);
  });
});

describe('parseTaskKey', () => {
  it('parses keys case-insensitively', () => {
    expect(parseTaskKey('eng-42')).toEqual({ projectKey: 'ENG', number: 42 });
    expect(parseTaskKey('OPS2-7')).toEqual({ projectKey: 'OPS2', number: 7 });
  });

  it('rejects malformed keys', () => {
    for (const bad of ['ENG', 'ENG-', '42', 'E-1', 'ENG-1-2', '1ENG-3', 'ENG-x']) {
      expect(parseTaskKey(bad), bad).toBeNull();
    }
  });
});

describe('diffTask', () => {
  const base: Task = {
    id: 't',
    workspaceId: 'w',
    projectId: 'p',
    number: 1,
    title: 'A',
    description: 'long text',
    statusId: 's1',
    priority: 'none',
    assigneeId: null,
    dueDate: null,
    estimate: null,
    parentId: null,
    sortOrder: 0,
    version: 1,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
  };

  it('records changed fields only, without description text', () => {
    const changes = diffTask(
      base,
      { ...base, title: 'B', description: 'other', sortOrder: 5, version: 2 },
      { before: ['l1', 'l2'], after: ['l2', 'l3'] },
    );
    expect(changes).toEqual({
      title: { from: 'A', to: 'B' },
      description: { from: null, to: null },
      labels: { from: ['l1'], to: ['l3'] },
    });
  });

  it('returns nothing for a pure reorder', () => {
    expect(diffTask(base, { ...base, sortOrder: 99, version: 2 })).toEqual({});
  });
});

describe('parseMentions', () => {
  it('extracts unique user ids in order', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    expect(parseMentions(`<@${b}> hi <@${a}> and <@${b.toUpperCase()}>`)).toEqual([b, a]);
    expect(parseMentions('email me at a@b.com <@not-a-uuid>')).toEqual([]);
  });
});

describe('defaultStatus', () => {
  const s = (name: string, category: Status['category'], position: number): Status => ({
    id: name,
    projectId: 'p',
    name,
    category,
    color: '#000000',
    position,
  });

  it('prefers the first todo status, falling back to the first status', () => {
    expect(
      defaultStatus([s('Later', 'todo', 3), s('Backlog', 'backlog', 0), s('Now', 'todo', 1)])?.name,
    ).toBe('Now');
    expect(defaultStatus([s('Doing', 'in_progress', 1), s('Ideas', 'backlog', 0)])?.name).toBe(
      'Ideas',
    );
    expect(defaultStatus([])).toBeUndefined();
  });
});

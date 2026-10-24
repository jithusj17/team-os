import { describe, expect, it } from 'vitest';
import type { WorkspaceEvent } from '@team-os/shared';
import {
  deriveNotifications,
  describe as describeNotification,
  excerpt,
  type FanoutContext,
} from '../../src/modules/notifications/domain/notification.js';

const task = { id: 'task-1', key: 'ENG-1', title: 'Fix login', projectId: 'p1' };

const event = (
  type: WorkspaceEvent['type'],
  payload: unknown,
  actorId = 'alice',
): WorkspaceEvent => ({
  workspaceId: 'ws',
  seq: 7,
  type,
  projectId: 'p1',
  taskId: task.id,
  actorId,
  payload,
  createdAt: new Date(),
});

const ctx = (e: WorkspaceEvent, extra: Partial<FanoutContext> = {}): FanoutContext => ({
  event: e,
  task,
  watchers: [],
  dependents: [],
  ...extra,
});

const summary = (c: FanoutContext) => deriveNotifications(c).map((d) => `${d.userId}:${d.type}`);

describe('deriveNotifications', () => {
  it('notifies a new assignee, but not someone assigning themselves', () => {
    expect(summary(ctx(event('task.created', { assigneeId: 'bob' })))).toEqual(['bob:assigned']);
    expect(summary(ctx(event('task.created', { assigneeId: 'alice' })))).toEqual([]);
    const reassigned = event('task.updated', {
      changes: { assigneeId: { from: 'bob', to: 'carol' } },
    });
    expect(summary(ctx(reassigned))).toEqual(['carol:assigned']);
  });

  it('tells watchers about status changes, without double-notifying a new assignee', () => {
    const e = event('task.updated', {
      changes: { statusId: { from: 's1', to: 's2' }, assigneeId: { from: null, to: 'bob' } },
    });
    const drafts = deriveNotifications(
      ctx(e, { watchers: ['alice', 'bob', 'carol'], statusName: 'Done' }),
    );
    expect(drafts.map((d) => `${d.userId}:${d.type}`)).toEqual([
      'bob:assigned',
      'carol:status_changed',
    ]);
    expect(drafts[1]!.data).toMatchObject({ statusName: 'Done', taskKey: 'ENG-1' });
  });

  it('separates mentions from ordinary comment notifications', () => {
    const e = event('comment.created', { id: 'c1', body: 'hey <@bob>', mentions: ['bob'] });
    expect(summary(ctx(e, { watchers: ['alice', 'bob', 'carol'] }))).toEqual([
      'bob:mentioned',
      'carol:commented',
    ]);
  });

  it('tells people on dependent tasks when a blocker is completed', () => {
    const e = event('task.updated', { changes: { completed: { from: false, to: true } } });
    const dependents = [
      { id: 'task-2', key: 'ENG-2', title: 'Ship', projectId: 'p1', userIds: ['bob', 'alice'] },
    ];
    const drafts = deriveNotifications(ctx(e, { dependents }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      userId: 'bob',
      type: 'blocker_resolved',
      taskId: 'task-2',
      data: { taskKey: 'ENG-2', blockerKey: 'ENG-1' },
    });
  });

  it('builds stable dedupe keys from the event', () => {
    const [draft] = deriveNotifications(ctx(event('task.created', { assigneeId: 'bob' })));
    expect(draft!.dedupeKey).toBe('ws:7:assigned:task-1');
  });

  it('ignores events without a task and unrelated event types', () => {
    expect(summary(ctx(event('task.created', { assigneeId: 'bob' }), { task: null }))).toEqual([]);
    expect(summary(ctx(event('label.changed', {})))).toEqual([]);
  });
});

describe('notification text', () => {
  it('builds readable excerpts and descriptions', () => {
    expect(excerpt(`Hi <@${'1'.repeat(8)}-1111-1111-1111-111111111111>,   see this`)).toBe(
      'Hi @, see this',
    );
    expect(excerpt('x'.repeat(200))).toHaveLength(140);
    expect(
      describeNotification(
        { type: 'assigned', data: { taskKey: 'ENG-4', taskTitle: 'Fix login' } },
        'Alice',
      ),
    ).toBe('Alice assigned you ENG-4: Fix login');
  });
});

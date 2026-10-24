import type { Notification, NotificationType, WorkspaceEvent } from '@team-os/shared';

export type { Notification, NotificationType };

/** A notification to create. `dedupeKey` makes creation idempotent per user. */
export interface NotificationDraft {
  userId: string;
  type: NotificationType;
  workspaceId: string;
  projectId: string | null;
  taskId: string | null;
  actorId: string | null;
  data: Notification['data'];
  dedupeKey: string;
}

export interface TaskRef {
  id: string;
  key: string;
  title: string;
  projectId: string;
}

/** Everything `deriveNotifications` needs besides the event itself, loaded by the caller. */
export interface FanoutContext {
  event: WorkspaceEvent;
  /** The task the event is about, if any (and if it still exists). */
  task: TaskRef | null;
  watchers: string[];
  /** For status changes: the new status's name. */
  statusName?: string;
  /** For a completed task: tasks it was blocking, and who to tell about each. */
  dependents: (TaskRef & { userIds: string[] })[];
}

type Changes = Record<string, { from: unknown; to: unknown } | undefined>;

const MENTION = /<@([0-9a-f-]{36})>/gi;
const EXCERPT_LENGTH = 140;

export function excerpt(body: string): string {
  const plain = body.replace(MENTION, '@').replace(/\s+/g, ' ').trim();
  return plain.length > EXCERPT_LENGTH ? `${plain.slice(0, EXCERPT_LENGTH - 1)}…` : plain;
}

/**
 * Who should be notified about an event, and why. Pure: no I/O, no permission checks (the
 * caller filters drafts by access and preferences). Nobody is notified about their own action,
 * and each person gets at most one notification of a given type per event and task.
 */
export function deriveNotifications(ctx: FanoutContext): NotificationDraft[] {
  const { event, task } = ctx;
  if (!task) return [];
  const drafts: NotificationDraft[] = [];

  const add = (
    userId: string | null | undefined,
    type: NotificationType,
    about: TaskRef = task,
    data: Notification['data'] = {},
  ) => {
    if (!userId || userId === event.actorId) return;
    if (drafts.some((d) => d.userId === userId && d.type === type && d.taskId === about.id)) return;
    drafts.push({
      userId,
      type,
      workspaceId: event.workspaceId,
      projectId: about.projectId,
      taskId: about.id,
      actorId: event.actorId,
      data: { taskKey: about.key, taskTitle: about.title, ...data },
      dedupeKey: `${event.workspaceId}:${event.seq}:${type}:${about.id}`,
    });
  };

  switch (event.type) {
    case 'task.created': {
      add((event.payload as { assigneeId?: string | null }).assigneeId, 'assigned');
      break;
    }
    case 'task.updated': {
      const changes = ((event.payload as { changes?: Changes }).changes ?? {}) as Changes;
      const assignedTo = changes.assigneeId?.to as string | null | undefined;
      add(assignedTo, 'assigned');
      if (changes.statusId) {
        for (const watcher of ctx.watchers) {
          if (watcher !== assignedTo)
            add(watcher, 'status_changed', task, { statusName: ctx.statusName });
        }
      }
      if (changes.completed?.to === true) {
        for (const dependent of ctx.dependents) {
          for (const userId of dependent.userIds) {
            add(userId, 'blocker_resolved', dependent, { blockerKey: task.key });
          }
        }
      }
      break;
    }
    case 'comment.created': {
      const comment = event.payload as { id: string; body: string; mentions: string[] };
      const data = { commentId: comment.id, excerpt: excerpt(comment.body) };
      for (const userId of comment.mentions) add(userId, 'mentioned', task, data);
      for (const watcher of ctx.watchers) {
        if (!comment.mentions.includes(watcher)) add(watcher, 'commented', task, data);
      }
      break;
    }
    default:
      break;
  }
  return drafts;
}

/** A one-line description for emails, e.g. "Alice assigned you ENG-4: Fix login". */
export function describe(n: Pick<Notification, 'type' | 'data'>, actorName: string | null): string {
  const who = actorName ?? 'Someone';
  const task = `${n.data.taskKey ?? ''}: ${n.data.taskTitle ?? ''}`.trim();
  switch (n.type) {
    case 'assigned':
      return `${who} assigned you ${task}`;
    case 'mentioned':
      return `${who} mentioned you on ${task}`;
    case 'commented':
      return `${who} commented on ${task}`;
    case 'status_changed':
      return `${who} moved ${task} to ${n.data.statusName ?? 'a new status'}`;
    case 'blocker_resolved':
      return `${n.data.blockerKey ?? 'A blocker'} is done, unblocking ${task}`;
    case 'due_soon':
      return `${task} is due ${n.data.dueDate ?? 'soon'}`;
  }
}

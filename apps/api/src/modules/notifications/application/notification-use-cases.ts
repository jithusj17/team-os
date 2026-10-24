import type { NotificationPreferences, WorkspaceEvent } from '@team-os/shared';
import type { AppUrls, Clock, JobQueue } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { ProjectAccess } from '../../projects/application/project-access.js';
import type { StatusRepository } from '../../projects/domain/ports.js';
import type {
  DependencyRepository,
  TaskRepository,
  WatcherRepository,
} from '../../tasks/domain/ports.js';
import {
  deriveNotifications,
  describe,
  type FanoutContext,
  type Notification,
  type NotificationDraft,
  type TaskRef,
} from '../domain/notification.js';
import type {
  NotificationPusher,
  NotificationRepository,
  PreferenceRepository,
  StoredNotification,
} from '../domain/ports.js';

type Repos = {
  notifications: NotificationRepository;
  preferences: PreferenceRepository;
  tasks: TaskRepository;
  watchers: WatcherRepository;
  dependencies: DependencyRepository;
  statuses: StatusRepository;
};

type DeliveryDeps = {
  uow: UnitOfWork<Repos>;
  projectAccess: ProjectAccess;
  pusher: NotificationPusher;
};

/**
 * Stores and pushes drafts, dropping any for users who can no longer see the project or
 * who muted that type. Safe to call repeatedly with the same drafts (dedupe keys).
 */
async function deliver(
  deps: DeliveryDeps,
  drafts: NotificationDraft[],
): Promise<StoredNotification[]> {
  if (drafts.length === 0) return [];
  const { notifications, preferences } = deps.uow.repos;

  const grants = new Map<string, boolean>();
  const canSee = async (userId: string, projectId: string | null) => {
    if (!projectId) return true;
    const key = `${userId}:${projectId}`;
    if (!grants.has(key))
      grants.set(key, (await deps.projectAccess.grantFor(userId, projectId)) !== null);
    return grants.get(key)!;
  };

  const prefs = await preferences.getMany([...new Set(drafts.map((d) => d.userId))]);
  const allowed: NotificationDraft[] = [];
  for (const draft of drafts) {
    if (prefs.get(draft.userId)?.mutedTypes.includes(draft.type)) continue;
    if (await canSee(draft.userId, draft.projectId)) allowed.push(draft);
  }

  const inserted = await notifications.insertMany(allowed);
  await Promise.all(inserted.map((n) => deps.pusher.push(n)));
  return inserted;
}

const taskRef = (t: { id: string; key: string; title: string; projectId: string }): TaskRef => ({
  id: t.id,
  key: t.key,
  title: t.title,
  projectId: t.projectId,
});

/** Turns one committed workspace event into notifications. Runs in the worker. */
export class FanOutEvent {
  constructor(private readonly deps: DeliveryDeps) {}

  async execute(event: WorkspaceEvent): Promise<StoredNotification[]> {
    if (
      !['task.created', 'task.updated', 'comment.created'].includes(event.type) ||
      !event.taskId
    ) {
      return [];
    }
    const { tasks, watchers, statuses, dependencies } = this.deps.uow.repos;
    const view = await tasks.findView(event.taskId);
    if (!view) return []; // deleted since; nothing to point anyone at

    const changes = (event.payload as { changes?: Record<string, { to?: unknown }> }).changes ?? {};
    const ctx: FanoutContext = {
      event,
      task: taskRef(view),
      watchers: await watchers.list(view.id),
      dependents: [],
    };
    if (changes.statusId?.to) {
      ctx.statusName = (await statuses.findById(changes.statusId.to as string))?.name;
    }
    if (changes.completed?.to === true) {
      const { blocking } = await dependencies.forTask(view.id);
      for (const dependent of blocking) {
        const dependentView = await tasks.findView(dependent.id);
        if (!dependentView) continue;
        const userIds = await watchers.list(dependent.id);
        if (dependentView.assigneeId) userIds.push(dependentView.assigneeId);
        ctx.dependents.push({ ...taskRef(dependentView), userIds: [...new Set(userIds)] });
      }
    }
    return deliver(this.deps, deriveNotifications(ctx));
  }
}

/** Reminds assignees about open tasks due today or tomorrow. Runs on a schedule; idempotent. */
export class SendDueSoonReminders {
  constructor(private readonly deps: DeliveryDeps & { clock: Clock }) {}

  async execute(): Promise<StoredNotification[]> {
    const today = this.deps.clock.now();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const day = (d: Date) => d.toISOString().slice(0, 10);

    const due = await this.deps.uow.repos.tasks.findDueBetween(day(today), day(tomorrow));
    const drafts: NotificationDraft[] = due.map((t) => ({
      userId: t.assigneeId,
      type: 'due_soon',
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      taskId: t.id,
      actorId: null,
      data: { taskKey: t.key, taskTitle: t.title, dueDate: t.dueDate ?? undefined },
      // One reminder per task per due date, however often the job runs.
      dedupeKey: `due_soon:${t.id}:${t.dueDate}`,
    }));
    return deliver(this.deps, drafts);
  }
}

/** Emails each opted-in user a summary of unread notifications from the last day. */
export class SendEmailDigests {
  constructor(
    private readonly deps: {
      uow: UnitOfWork<Repos>;
      jobs: JobQueue;
      urls: AppUrls;
      clock: Clock;
    },
  ) {}

  async execute(): Promise<number> {
    const now = this.deps.clock.now();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { notifications } = this.deps.uow.repos;
    const batches = await notifications.digestBatches(since);

    for (const batch of batches) {
      await this.deps.jobs.sendEmail({
        type: 'notification-digest',
        to: batch.email,
        name: batch.name,
        items: batch.notifications.map((n) => ({
          text: describe(n, n.actorName),
          url: this.deps.urls.task(n.workspaceId, n.data.taskKey ?? ''),
        })),
      });
      // Marked only after the email job is queued, so a crash re-sends rather than skips.
      await notifications.markEmailed(
        batch.notifications.map((n) => n.id),
        now,
      );
    }
    return batches.length;
  }
}

// ---- Inbox (HTTP) ----

type InboxDeps = { uow: UnitOfWork<Pick<Repos, 'notifications' | 'preferences'>>; clock: Clock };

export class ListNotifications {
  constructor(private readonly deps: InboxDeps) {}

  async execute(
    userId: string,
    opts: { unreadOnly: boolean; cursor?: string; limit: number },
  ): Promise<{ items: Notification[]; nextCursor: string | null; unreadCount: number }> {
    const { notifications } = this.deps.uow.repos;
    const [page, unreadCount] = await Promise.all([
      notifications.list(userId, opts),
      notifications.unreadCount(userId),
    ]);
    return { ...page, unreadCount };
  }
}

export class MarkNotificationsRead {
  constructor(private readonly deps: InboxDeps) {}

  async execute(userId: string, which: string[] | 'all') {
    // Scoped to the user in the query, so other people's ids are silently ignored.
    const updated = await this.deps.uow.repos.notifications.markRead(
      userId,
      which,
      this.deps.clock.now(),
    );
    return { updated, unreadCount: await this.deps.uow.repos.notifications.unreadCount(userId) };
  }
}

export class GetNotificationPreferences {
  constructor(private readonly deps: InboxDeps) {}

  execute(userId: string) {
    return this.deps.uow.repos.preferences.get(userId);
  }
}

export class UpdateNotificationPreferences {
  constructor(private readonly deps: InboxDeps) {}

  execute(userId: string, prefs: NotificationPreferences) {
    return this.deps.uow.repos.preferences.set(userId, {
      mutedTypes: [...new Set(prefs.mutedTypes)],
      emailDigest: prefs.emailDigest,
    });
  }
}

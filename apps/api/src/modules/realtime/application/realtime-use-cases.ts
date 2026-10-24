import { effectiveProjectRole, type EventsResponse } from '@team-os/shared';
import type { EventRepository } from '../../../shared/application/events.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { ProjectAccess } from '../../projects/application/project-access.js';
import type { ProjectRepository } from '../../projects/domain/ports.js';
import type { TaskAccess } from '../../tasks/application/task-use-cases.js';
import type { WorkspaceAccess } from '../../workspaces/application/workspace-access.js';
import { projectRoom, taskRoom, workspaceRoom } from '../domain/rooms.js';
import type { PresenceStore } from './ports.js';

type Repos = { events: EventRepository; projects: ProjectRepository };

/**
 * Catch-up for clients that were offline: every event after `after` that the user may see.
 * Clients call this on (re)connect with the last seq they processed.
 */
export class ListEventsSince {
  constructor(
    private readonly deps: { uow: UnitOfWork<Repos>; workspaceAccess: WorkspaceAccess },
  ) {}

  async execute(
    actorId: string,
    workspaceId: string,
    after: number,
    limit: number,
  ): Promise<EventsResponse> {
    const workspaceRole = await this.deps.workspaceAccess.authorize(actorId, workspaceId, {
      action: 'workspace:read',
    });
    const { events, projects } = this.deps.uow.repos;
    const [latest, oldest] = await Promise.all([
      events.latestSeq(workspaceId),
      events.oldestSeq(workspaceId),
    ]);

    // Missed events were pruned (or the client is ahead of us): it must refetch everything.
    const pruned = oldest !== null && after < oldest - 1;
    if (after > latest || (after < latest && pruned)) {
      return { events: [], latestSeq: latest, hasMore: false, resyncRequired: true };
    }

    const rows = await events.listSince(workspaceId, after, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    const visibleProjects = new Set(
      (await projects.listWithExplicitRole(workspaceId, actorId))
        .filter((p) => effectiveProjectRole(workspaceRole, p.visibility, p.explicitRole))
        .map((p) => p.id),
    );
    const visible = page.filter(
      (e) =>
        e.projectId === null ||
        visibleProjects.has(e.projectId) ||
        // The project is gone, so there is nothing left to hide; clients drop it from caches.
        e.type === 'project.deleted',
    );

    return {
      events: visible,
      latestSeq: hasMore ? page.at(-1)!.seq : latest,
      hasMore,
      resyncRequired: false,
    };
  }
}

export type RoomTarget = { workspaceId: string } | { projectId: string } | { taskId: string };

/** Decides which Socket.IO rooms a user may join, using the same rules as the HTTP API. */
export class RealtimeAccess {
  constructor(
    private readonly deps: {
      workspaceAccess: WorkspaceAccess;
      projectAccess: ProjectAccess;
      taskAccess: TaskAccess;
      uow: UnitOfWork<Repos>;
    },
  ) {}

  /** Returns the room for `target` and the workspace's latest seq, or throws if not allowed. */
  async authorize(
    actorId: string,
    target: RoomTarget,
  ): Promise<{ room: string; latestSeq: number }> {
    const { events } = this.deps.uow.repos;
    if ('workspaceId' in target) {
      await this.deps.workspaceAccess.authorize(actorId, target.workspaceId, {
        action: 'workspace:read',
      });
      return {
        room: workspaceRoom(target.workspaceId),
        latestSeq: await events.latestSeq(target.workspaceId),
      };
    }
    if ('projectId' in target) {
      const { project } = await this.deps.projectAccess.authorize(
        actorId,
        target.projectId,
        'project:read',
      );
      return {
        room: projectRoom(project.id),
        latestSeq: await events.latestSeq(project.workspaceId),
      };
    }
    const { task } = await this.deps.taskAccess.authorize(actorId, target.taskId, 'project:read');
    return { room: taskRoom(task.id), latestSeq: await events.latestSeq(task.workspaceId) };
  }
}

/** Who is looking at a project or task right now. */
export class Presence {
  constructor(private readonly deps: { access: RealtimeAccess; store: PresenceStore }) {}

  async enter(actorId: string, connectionId: string, target: RoomTarget) {
    const { room } = await this.deps.access.authorize(actorId, target);
    await this.deps.store.enter(room, connectionId, actorId);
    return { room, userIds: await this.deps.store.userIds(room) };
  }

  async leave(room: string, connectionId: string) {
    await this.deps.store.leave(room, connectionId);
    return { room, userIds: await this.deps.store.userIds(room) };
  }
}

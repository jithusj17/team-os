import type { EventRepository } from '../../../shared/application/events.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { conflict, notFound, validation } from '../../../shared/domain/errors.js';
import type { NewStatus, Project, Status } from '../domain/project.js';
import type { StatusRepository } from '../domain/ports.js';
import type { ProjectAccess } from './project-access.js';
import { projectEvent } from './project-use-cases.js';

type Repos = { statuses: StatusRepository; events: EventRepository };
type Deps = { uow: UnitOfWork<Repos>; projectAccess: ProjectAccess };

const statusNotFound = () => notFound('status_not_found', 'Status not found');

/** Loads a status and checks it belongs to the project (so IDs from other projects 404). */
async function requireStatus(statuses: StatusRepository, projectId: string, statusId: string) {
  const status = await statuses.findById(statusId);
  if (!status || status.projectId !== projectId) throw statusNotFound();
  return status;
}

/** Statuses are a small ordered list, so every change publishes the whole list. */
async function recordStatusesChanged(
  { statuses, events }: Repos,
  project: Project,
  actorId: string,
  extra: Record<string, unknown> = {},
) {
  const list = await statuses.listForProject(project.id);
  await events.append(
    projectEvent('project.statuses_changed', project, actorId, { statuses: list, ...extra }),
  );
  return list;
}

export class CreateStatus {
  constructor(private readonly deps: Deps) {}

  async execute(
    actorId: string,
    projectId: string,
    input: Omit<NewStatus, 'position'>,
  ): Promise<Status> {
    const { project } = await this.deps.projectAccess.authorize(
      actorId,
      projectId,
      'status:manage',
    );
    return this.deps.uow.transaction(async (repos) => {
      const existing = await repos.statuses.listForProject(projectId);
      const position = Math.max(-1, ...existing.map((s) => s.position)) + 1;
      const [created] = await repos.statuses.createMany(projectId, [{ ...input, position }]);
      await recordStatusesChanged(repos, project, actorId);
      return created!;
    });
  }
}

export class UpdateStatus {
  constructor(private readonly deps: Deps) {}

  async execute(
    actorId: string,
    projectId: string,
    statusId: string,
    patch: Partial<Omit<NewStatus, 'position'>>,
  ): Promise<Status> {
    const { project } = await this.deps.projectAccess.authorize(
      actorId,
      projectId,
      'status:manage',
    );
    return this.deps.uow.transaction(async (repos) => {
      await requireStatus(repos.statuses, projectId, statusId);
      const updated = await repos.statuses.update(statusId, patch);
      if (!updated) throw statusNotFound();
      await recordStatusesChanged(repos, project, actorId);
      return updated;
    });
  }
}

export class ReorderStatuses {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, projectId: string, orderedIds: string[]): Promise<Status[]> {
    const { project } = await this.deps.projectAccess.authorize(
      actorId,
      projectId,
      'status:manage',
    );
    return this.deps.uow.transaction(async (repos) => {
      const current = await repos.statuses.listForProject(projectId);
      const same =
        orderedIds.length === current.length &&
        new Set(orderedIds).size === orderedIds.length &&
        current.every((s) => orderedIds.includes(s.id));
      if (!same) {
        throw validation('invalid_status_order', "List every one of the project's statuses once");
      }
      await repos.statuses.setPositions(projectId, orderedIds);
      return recordStatusesChanged(repos, project, actorId);
    });
  }
}

export class DeleteStatus {
  constructor(private readonly deps: Deps) {}

  /** Deletes a status. Its tasks must be moved to `moveTo` if it has any. */
  async execute(actorId: string, projectId: string, statusId: string, moveTo?: string) {
    const { project } = await this.deps.projectAccess.authorize(
      actorId,
      projectId,
      'status:manage',
    );
    await this.deps.uow.transaction(async (repos) => {
      const { statuses } = repos;
      await requireStatus(statuses, projectId, statusId);
      const all = await statuses.listForProject(projectId);
      if (all.length === 1) throw conflict('last_status', 'A project needs at least one status');

      if (moveTo !== undefined) {
        if (moveTo === statusId) throw validation('invalid_target', 'Choose a different status');
        await requireStatus(statuses, projectId, moveTo);
      } else if ((await statuses.countTasks(statusId)) > 0) {
        throw conflict('status_in_use', "Move this status's tasks to another status first");
      }
      await statuses.deleteAndReassign(statusId, moveTo ?? null);
      // Moved tasks changed status in bulk; clients refetch the project's tasks.
      await recordStatusesChanged(repos, project, actorId, { tasksMoved: moveTo !== undefined });
    });
  }
}

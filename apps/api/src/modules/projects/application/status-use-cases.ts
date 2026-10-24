import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { conflict, notFound, validation } from '../../../shared/domain/errors.js';
import type { NewStatus, Status } from '../domain/project.js';
import type { StatusRepository } from '../domain/ports.js';
import type { ProjectAccess } from './project-access.js';

type Deps = { uow: UnitOfWork<{ statuses: StatusRepository }>; projectAccess: ProjectAccess };

const statusNotFound = () => notFound('status_not_found', 'Status not found');

/** Loads a status and checks it belongs to the project (so IDs from other projects 404). */
async function requireStatus(statuses: StatusRepository, projectId: string, statusId: string) {
  const status = await statuses.findById(statusId);
  if (!status || status.projectId !== projectId) throw statusNotFound();
  return status;
}

export class CreateStatus {
  constructor(private readonly deps: Deps) {}

  async execute(
    actorId: string,
    projectId: string,
    input: Omit<NewStatus, 'position'>,
  ): Promise<Status> {
    await this.deps.projectAccess.authorize(actorId, projectId, 'status:manage');
    return this.deps.uow.transaction(async ({ statuses }) => {
      const existing = await statuses.listForProject(projectId);
      const position = Math.max(-1, ...existing.map((s) => s.position)) + 1;
      const [created] = await statuses.createMany(projectId, [{ ...input, position }]);
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
    await this.deps.projectAccess.authorize(actorId, projectId, 'status:manage');
    const { statuses } = this.deps.uow.repos;
    await requireStatus(statuses, projectId, statusId);
    const updated = await statuses.update(statusId, patch);
    if (!updated) throw statusNotFound();
    return updated;
  }
}

export class ReorderStatuses {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, projectId: string, orderedIds: string[]): Promise<Status[]> {
    await this.deps.projectAccess.authorize(actorId, projectId, 'status:manage');
    return this.deps.uow.transaction(async ({ statuses }) => {
      const current = await statuses.listForProject(projectId);
      const same =
        orderedIds.length === current.length &&
        new Set(orderedIds).size === orderedIds.length &&
        current.every((s) => orderedIds.includes(s.id));
      if (!same) {
        throw validation('invalid_status_order', "List every one of the project's statuses once");
      }
      await statuses.setPositions(projectId, orderedIds);
      return statuses.listForProject(projectId);
    });
  }
}

export class DeleteStatus {
  constructor(private readonly deps: Deps) {}

  /** Deletes a status. Its tasks must be moved to `moveTo` if it has any. */
  async execute(actorId: string, projectId: string, statusId: string, moveTo?: string) {
    await this.deps.projectAccess.authorize(actorId, projectId, 'status:manage');
    await this.deps.uow.transaction(async ({ statuses }) => {
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
    });
  }
}

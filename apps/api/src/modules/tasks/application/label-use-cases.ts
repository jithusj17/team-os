import type { EventRepository } from '../../../shared/application/events.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { notFound } from '../../../shared/domain/errors.js';
import type { WorkspaceAccess } from '../../workspaces/application/workspace-access.js';
import type { Label } from '../domain/label.js';
import type { LabelRepository } from '../domain/ports.js';

type Deps = {
  uow: UnitOfWork<{ labels: LabelRepository; events: EventRepository }>;
  workspaceAccess: WorkspaceAccess;
};

const labelNotFound = () => notFound('label_not_found', 'Label not found');

/** Labels are small and shared, so clients simply refetch the list on any label change. */
const labelChanged = (workspaceId: string, actorId: string) => ({
  workspaceId,
  type: 'label.changed' as const,
  actorId,
  payload: {},
});

export class ListLabels {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, workspaceId: string): Promise<Label[]> {
    await this.deps.workspaceAccess.authorize(actorId, workspaceId, { action: 'workspace:read' });
    return this.deps.uow.repos.labels.list(workspaceId);
  }
}

export class CreateLabel {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, workspaceId: string, input: Omit<Label, 'id'>): Promise<Label> {
    await this.deps.workspaceAccess.authorize(actorId, workspaceId, { action: 'label:manage' });
    return this.deps.uow.transaction(async ({ labels, events }) => {
      const label = await labels.create(workspaceId, input);
      await events.append(labelChanged(workspaceId, actorId));
      return label;
    });
  }
}

export class UpdateLabel {
  constructor(private readonly deps: Deps) {}

  async execute(
    actorId: string,
    workspaceId: string,
    labelId: string,
    patch: Partial<Omit<Label, 'id'>>,
  ): Promise<Label> {
    await this.deps.workspaceAccess.authorize(actorId, workspaceId, { action: 'label:manage' });
    return this.deps.uow.transaction(async ({ labels, events }) => {
      const label = await labels.update(workspaceId, labelId, patch);
      if (!label) throw labelNotFound();
      await events.append(labelChanged(workspaceId, actorId));
      return label;
    });
  }
}

export class DeleteLabel {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, workspaceId: string, labelId: string) {
    await this.deps.workspaceAccess.authorize(actorId, workspaceId, { action: 'label:delete' });
    await this.deps.uow.transaction(async ({ labels, events }) => {
      if (!(await labels.delete(workspaceId, labelId))) throw labelNotFound();
      await events.append(labelChanged(workspaceId, actorId));
    });
  }
}

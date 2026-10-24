import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { notFound } from '../../../shared/domain/errors.js';
import type { WorkspaceAccess } from '../../workspaces/application/workspace-access.js';
import type { Label } from '../domain/label.js';
import type { LabelRepository } from '../domain/ports.js';

type Deps = { uow: UnitOfWork<{ labels: LabelRepository }>; workspaceAccess: WorkspaceAccess };

const labelNotFound = () => notFound('label_not_found', 'Label not found');

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
    return this.deps.uow.repos.labels.create(workspaceId, input);
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
    const label = await this.deps.uow.repos.labels.update(workspaceId, labelId, patch);
    if (!label) throw labelNotFound();
    return label;
  }
}

export class DeleteLabel {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, workspaceId: string, labelId: string) {
    await this.deps.workspaceAccess.authorize(actorId, workspaceId, { action: 'label:delete' });
    if (!(await this.deps.uow.repos.labels.delete(workspaceId, labelId))) throw labelNotFound();
  }
}

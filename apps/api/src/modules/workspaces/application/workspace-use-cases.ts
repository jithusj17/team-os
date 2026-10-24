import type { TokenService } from '../../../shared/application/ports.js';
import type { EventRepository } from '../../../shared/application/events.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { DomainError, conflict, notFound } from '../../../shared/domain/errors.js';
import type { MemberRepository, WorkspaceRepository } from '../domain/ports.js';
import { slugWithSuffix, slugify, type WorkspaceView } from '../domain/workspace.js';
import type { WorkspaceAccess } from './workspace-access.js';

type Repos = {
  workspaces: WorkspaceRepository;
  members: MemberRepository;
  events: EventRepository;
};

const isSlugTaken = (err: unknown) => err instanceof DomainError && err.code === 'slug_taken';

export class ListMyWorkspaces {
  constructor(private readonly deps: { uow: UnitOfWork<Repos> }) {}

  execute(actorId: string): Promise<WorkspaceView[]> {
    return this.deps.uow.repos.workspaces.listForUser(actorId);
  }
}

export class CreateWorkspace {
  constructor(private readonly deps: { uow: UnitOfWork<Repos>; tokens: TokenService }) {}

  async execute(actorId: string, input: { name: string; slug?: string }): Promise<WorkspaceView> {
    const base = input.slug ?? slugify(input.name);

    // A derived slug gets a random suffix on collision; an explicit one is the user's choice.
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : slugWithSuffix(base, this.deps.tokens.shortId());
      try {
        return await this.deps.uow.transaction(async ({ workspaces, members }) => {
          const ws = await workspaces.create({ name: input.name, slug, createdBy: actorId });
          await members.add(ws.id, actorId, 'owner');
          return { ...ws, role: 'owner' as const };
        });
      } catch (err) {
        if (!isSlugTaken(err) || input.slug) throw err;
      }
    }
    throw conflict('slug_taken', 'Could not find an available workspace URL');
  }
}

export class GetWorkspace {
  constructor(private readonly deps: { uow: UnitOfWork<Repos>; access: WorkspaceAccess }) {}

  async execute(actorId: string, workspaceId: string): Promise<WorkspaceView> {
    const role = await this.deps.access.authorize(actorId, workspaceId, {
      action: 'workspace:read',
    });
    const ws = await this.deps.uow.repos.workspaces.findById(workspaceId);
    if (!ws) throw notFound('workspace_not_found', 'Workspace not found');
    return { ...ws, role };
  }
}

export class UpdateWorkspace {
  constructor(private readonly deps: { uow: UnitOfWork<Repos>; access: WorkspaceAccess }) {}

  async execute(
    actorId: string,
    workspaceId: string,
    patch: { name?: string; slug?: string },
  ): Promise<WorkspaceView> {
    const role = await this.deps.access.authorize(actorId, workspaceId, {
      action: 'workspace:update',
    });
    return this.deps.uow.transaction(async ({ workspaces, events }) => {
      const ws = await workspaces.update(workspaceId, patch);
      if (!ws) throw notFound('workspace_not_found', 'Workspace not found');
      await events.append({ workspaceId, type: 'workspace.updated', actorId, payload: ws });
      return { ...ws, role };
    });
  }
}

export class DeleteWorkspace {
  constructor(private readonly deps: { uow: UnitOfWork<Repos>; access: WorkspaceAccess }) {}

  async execute(actorId: string, workspaceId: string) {
    await this.deps.access.authorize(actorId, workspaceId, { action: 'workspace:delete' });
    await this.deps.uow.repos.workspaces.delete(workspaceId);
  }
}

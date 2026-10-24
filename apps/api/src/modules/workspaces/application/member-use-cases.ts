import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { notFound } from '../../../shared/domain/errors.js';
import { assertNotLastOwner, type Member } from '../domain/membership.js';
import type { MemberRepository } from '../domain/ports.js';
import type { WorkspaceRole } from '../domain/workspace.js';
import type { WorkspaceAccess } from './workspace-access.js';

type Repos = { members: MemberRepository };
type Deps = { uow: UnitOfWork<Repos>; access: WorkspaceAccess };

async function requireMemberRole(members: MemberRepository, workspaceId: string, userId: string) {
  const role = await members.findRole(workspaceId, userId);
  if (!role) throw notFound('member_not_found', 'Member not found');
  return role;
}

export class ListMembers {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, workspaceId: string): Promise<Member[]> {
    await this.deps.access.authorize(actorId, workspaceId, { action: 'member:list' });
    return this.deps.uow.repos.members.list(workspaceId);
  }
}

export class ChangeMemberRole {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, workspaceId: string, userId: string, newRole: WorkspaceRole) {
    // The caller's membership is checked first, so non-members can't probe member IDs.
    await this.deps.access.authorize(actorId, workspaceId, { action: 'workspace:read' });

    await this.deps.uow.transaction(async ({ members }) => {
      const targetRole = await requireMemberRole(members, workspaceId, userId);
      await this.deps.access.authorize(actorId, workspaceId, {
        action: 'member:change-role',
        targetRole,
        newRole,
      });
      if (targetRole === 'owner' && newRole !== 'owner') {
        assertNotLastOwner(await members.lockOwnerIds(workspaceId), userId);
      }
      await members.updateRole(workspaceId, userId, newRole);
    });
  }
}

export class RemoveMember {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, workspaceId: string, userId: string) {
    await this.deps.access.authorize(actorId, workspaceId, { action: 'workspace:read' });

    await this.deps.uow.transaction(async ({ members }) => {
      const targetRole = await requireMemberRole(members, workspaceId, userId);
      await this.deps.access.authorize(actorId, workspaceId, {
        action: 'member:remove',
        targetRole,
        isSelf: actorId === userId,
      });
      if (targetRole === 'owner') {
        assertNotLastOwner(await members.lockOwnerIds(workspaceId), userId);
      }
      await members.remove(workspaceId, userId);
    });
  }
}

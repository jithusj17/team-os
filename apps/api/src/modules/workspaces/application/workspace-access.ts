import { canInWorkspace, type WorkspacePermissionCheck, type WorkspaceRole } from '@team-os/shared';
import { forbidden, notFound } from '../../../shared/domain/errors.js';
import type { MemberRepository } from '../domain/ports.js';

/**
 * The single entry point for workspace authorization. Every workspace-scoped use case
 * (including those in other modules) calls this before touching data.
 */
export class WorkspaceAccess {
  constructor(private readonly members: Pick<MemberRepository, 'findRole'>) {}

  /**
   * Returns the actor's role if they may perform `check`.
   * Non-members get not-found rather than forbidden, so workspace IDs can't be probed.
   */
  async authorize(
    actorId: string,
    workspaceId: string,
    check: WorkspacePermissionCheck,
  ): Promise<WorkspaceRole> {
    const role = await this.members.findRole(workspaceId, actorId);
    if (!role) throw notFound('workspace_not_found', 'Workspace not found');
    if (!canInWorkspace(role, check)) throw forbidden();
    return role;
  }
}

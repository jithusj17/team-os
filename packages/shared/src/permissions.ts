// Single source of truth for workspace permission rules.
// The API enforces these on every request; the web app uses them only to hide controls.

export const workspaceRoles = ['owner', 'admin', 'member', 'guest'] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

/** Roles that can be granted through an invite. Ownership is granted by promotion only. */
export const invitableRoles = ['admin', 'member', 'guest'] as const;
export type InvitableRole = (typeof invitableRoles)[number];

export type WorkspacePermissionCheck =
  | {
      action:
        | 'workspace:read'
        | 'workspace:update'
        | 'workspace:delete'
        | 'member:list'
        | 'invite:list'
        | 'invite:revoke';
    }
  | { action: 'invite:create'; role: WorkspaceRole }
  | { action: 'member:change-role'; targetRole: WorkspaceRole; newRole: WorkspaceRole }
  | { action: 'member:remove'; targetRole: WorkspaceRole; isSelf: boolean };

const isAdminOrOwner = (role: WorkspaceRole) => role === 'owner' || role === 'admin';
const isMemberOrGuest = (role: WorkspaceRole) => role === 'member' || role === 'guest';

/**
 * Whether a user with `actor` role may perform `check` in a workspace.
 * Invariants that need database state (e.g. "never remove the last owner") are enforced
 * by the API in addition to this check.
 */
export function canInWorkspace(actor: WorkspaceRole, check: WorkspacePermissionCheck): boolean {
  switch (check.action) {
    case 'workspace:read':
      return true;
    case 'member:list':
      return actor !== 'guest';
    case 'workspace:update':
    case 'invite:list':
    case 'invite:revoke':
      return isAdminOrOwner(actor);
    case 'workspace:delete':
      return actor === 'owner';
    case 'invite:create':
      if (check.role === 'owner') return false;
      if (check.role === 'admin') return actor === 'owner';
      return isAdminOrOwner(actor);
    case 'member:change-role':
      if (actor === 'owner') return true;
      // Admins manage members and guests, but cannot create or demote admins/owners.
      return (
        actor === 'admin' && isMemberOrGuest(check.targetRole) && isMemberOrGuest(check.newRole)
      );
    case 'member:remove':
      if (check.isSelf) return true;
      if (actor === 'owner') return true;
      return actor === 'admin' && isMemberOrGuest(check.targetRole);
  }
}

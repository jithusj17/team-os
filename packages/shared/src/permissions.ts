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
        | 'invite:revoke'
        | 'project:create'
        | 'label:manage'
        | 'label:delete';
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
    case 'project:create':
    case 'label:manage':
      return actor !== 'guest';
    case 'label:delete':
      return isAdminOrOwner(actor);
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

// ---- Projects ----

export const projectRoles = ['admin', 'editor', 'viewer'] as const;
export type ProjectRole = (typeof projectRoles)[number];

/** `workspace`: every workspace member can see it. `private`: only explicit project members. */
export const projectVisibilities = ['workspace', 'private'] as const;
export type ProjectVisibility = (typeof projectVisibilities)[number];

/**
 * A user's role in a project, combining their workspace role, the project's visibility and
 * any explicit project membership. Returns null if they cannot see the project at all.
 *
 * - Workspace owners and admins administer every project.
 * - Otherwise an explicit project role wins (so a member can be limited to viewer).
 * - Members get editor on workspace-visible projects. Guests need explicit membership.
 */
export function effectiveProjectRole(
  workspaceRole: WorkspaceRole,
  visibility: ProjectVisibility,
  explicitRole: ProjectRole | null,
): ProjectRole | null {
  if (workspaceRole === 'owner' || workspaceRole === 'admin') return 'admin';
  if (explicitRole) return explicitRole;
  if (workspaceRole === 'member' && visibility === 'workspace') return 'editor';
  return null;
}

export type ProjectAction =
  | 'project:read'
  | 'project:update'
  | 'project:delete'
  | 'project:manage-members'
  | 'status:manage'
  | 'task:create'
  | 'task:update'
  | 'task:delete'
  | 'comment:create'
  | 'comment:moderate';

const projectRank: Record<ProjectRole, number> = { viewer: 0, editor: 1, admin: 2 };

const minimumProjectRole: Record<ProjectAction, ProjectRole> = {
  'project:read': 'viewer',
  'comment:create': 'viewer',
  'task:create': 'editor',
  'task:update': 'editor',
  'task:delete': 'editor',
  'project:update': 'admin',
  'project:delete': 'admin',
  'project:manage-members': 'admin',
  'status:manage': 'admin',
  'comment:moderate': 'admin',
};

export function canInProject(role: ProjectRole, action: ProjectAction): boolean {
  return projectRank[role] >= projectRank[minimumProjectRole[action]];
}

// ---- Docs and meetings ----

export type DocAction = 'read' | 'edit' | 'delete';

/**
 * Docs live in a workspace (visible to members, not guests) or in a project (following the
 * project's roles). `projectRole` is the user's effective role in the doc's project, if any.
 */
export function canOnDoc(
  ctx: {
    workspaceRole: WorkspaceRole;
    isProjectDoc: boolean;
    projectRole: ProjectRole | null;
    isCreator: boolean;
  },
  action: DocAction,
): boolean {
  if (ctx.isProjectDoc) {
    if (!ctx.projectRole) return false;
    if (action === 'read') return true;
    if (action === 'edit') return ctx.projectRole !== 'viewer';
    return ctx.projectRole === 'admin' || (ctx.projectRole === 'editor' && ctx.isCreator);
  }
  if (ctx.workspaceRole === 'guest') return false;
  if (action === 'delete') return isAdminOrOwner(ctx.workspaceRole) || ctx.isCreator;
  return true;
}

export type MeetingAction = 'read' | 'edit' | 'rsvp';

/**
 * Attendees can always see a meeting they're invited to. Otherwise workspace meetings are
 * visible to members and project meetings to people who can see the project. Organizers,
 * workspace admins and project admins can change them.
 */
export function canOnMeeting(
  ctx: {
    workspaceRole: WorkspaceRole;
    isProjectMeeting: boolean;
    projectRole: ProjectRole | null;
    isOrganizer: boolean;
    isAttendee: boolean;
  },
  action: MeetingAction,
): boolean {
  switch (action) {
    case 'rsvp':
      return ctx.isAttendee;
    case 'read':
      return (
        ctx.isAttendee ||
        ctx.isOrganizer ||
        (ctx.isProjectMeeting ? ctx.projectRole !== null : ctx.workspaceRole !== 'guest')
      );
    case 'edit':
      return (
        ctx.isOrganizer ||
        isAdminOrOwner(ctx.workspaceRole) ||
        (ctx.isProjectMeeting && ctx.projectRole === 'admin')
      );
  }
}

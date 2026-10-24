import {
  canInProject,
  effectiveProjectRole,
  type ProjectAction,
  type ProjectRole,
  type WorkspaceRole,
} from '@team-os/shared';
import { forbidden, notFound } from '../../../shared/domain/errors.js';
import type { Project } from '../domain/project.js';
import type { ProjectRepository } from '../domain/ports.js';

export interface ProjectGrant {
  project: Project;
  role: ProjectRole;
  workspaceRole: WorkspaceRole;
}

/**
 * The single entry point for project authorization, used by the projects and tasks modules.
 * Users who can't see a project get not-found, so project IDs can't be probed.
 */
export class ProjectAccess {
  constructor(private readonly projects: Pick<ProjectRepository, 'findAccessContext'>) {}

  /** The user's effective role in the project, or null if they can't see it. */
  async grantFor(userId: string, projectId: string): Promise<ProjectGrant | null> {
    const ctx = await this.projects.findAccessContext(projectId, userId);
    if (!ctx?.workspaceRole) return null;
    const role = effectiveProjectRole(ctx.workspaceRole, ctx.project.visibility, ctx.explicitRole);
    return role ? { project: ctx.project, role, workspaceRole: ctx.workspaceRole } : null;
  }

  async authorize(
    actorId: string,
    projectId: string,
    action: ProjectAction,
    notFoundError = () => notFound('project_not_found', 'Project not found'),
  ): Promise<ProjectGrant> {
    const grant = await this.grantFor(actorId, projectId);
    if (!grant) throw notFoundError();
    if (!canInProject(grant.role, action)) throw forbidden();
    return grant;
  }
}

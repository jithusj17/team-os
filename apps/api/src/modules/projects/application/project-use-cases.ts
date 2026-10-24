import { effectiveProjectRole, type ProjectRole } from '@team-os/shared';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { notFound } from '../../../shared/domain/errors.js';
import type { WorkspaceAccess } from '../../workspaces/application/workspace-access.js';
import type { MemberRepository } from '../../workspaces/domain/ports.js';
import {
  DEFAULT_STATUSES,
  type ProjectMember,
  type ProjectPatch,
  type ProjectView,
  type ProjectVisibility,
  type Status,
} from '../domain/project.js';
import type {
  ProjectMemberRepository,
  ProjectRepository,
  StatusRepository,
} from '../domain/ports.js';
import type { ProjectAccess } from './project-access.js';

type Repos = {
  projects: ProjectRepository;
  projectMembers: ProjectMemberRepository;
  statuses: StatusRepository;
  members: MemberRepository;
};
type Deps = { uow: UnitOfWork<Repos>; projectAccess: ProjectAccess };

export type ProjectDetail = ProjectView & { statuses: Status[] };

export class ListProjects {
  constructor(private readonly deps: Deps & { workspaceAccess: WorkspaceAccess }) {}

  /** Projects in the workspace that the actor can see, with their role in each. */
  async execute(actorId: string, workspaceId: string): Promise<ProjectView[]> {
    const workspaceRole = await this.deps.workspaceAccess.authorize(actorId, workspaceId, {
      action: 'workspace:read',
    });
    const rows = await this.deps.uow.repos.projects.listWithExplicitRole(workspaceId, actorId);
    return rows.flatMap(({ explicitRole, ...project }) => {
      const role = effectiveProjectRole(workspaceRole, project.visibility, explicitRole);
      return role ? [{ ...project, role }] : [];
    });
  }
}

export class CreateProject {
  constructor(private readonly deps: Deps & { workspaceAccess: WorkspaceAccess }) {}

  async execute(
    actorId: string,
    workspaceId: string,
    input: { name: string; key: string; description: string; visibility: ProjectVisibility },
  ): Promise<ProjectDetail> {
    await this.deps.workspaceAccess.authorize(actorId, workspaceId, { action: 'project:create' });

    return this.deps.uow.transaction(async ({ projects, projectMembers, statuses }) => {
      const project = await projects.create({
        ...input,
        workspaceId,
        enforceDependencies: true,
        createdBy: actorId,
      });
      const created = await statuses.createMany(project.id, DEFAULT_STATUSES);
      // The creator administers the project, even if it is private.
      await projectMembers.upsert(project.id, actorId, 'admin');
      return { ...project, role: 'admin' as const, statuses: created };
    });
  }
}

export class GetProject {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, projectId: string): Promise<ProjectDetail> {
    const { project, role } = await this.deps.projectAccess.authorize(
      actorId,
      projectId,
      'project:read',
    );
    const statuses = await this.deps.uow.repos.statuses.listForProject(projectId);
    return { ...project, role, statuses };
  }
}

export class UpdateProject {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, projectId: string, patch: ProjectPatch): Promise<ProjectDetail> {
    const { role } = await this.deps.projectAccess.authorize(actorId, projectId, 'project:update');
    const { projects, statuses } = this.deps.uow.repos;
    const project = await projects.update(projectId, patch);
    if (!project) throw notFound('project_not_found', 'Project not found');
    return { ...project, role, statuses: await statuses.listForProject(projectId) };
  }
}

export class DeleteProject {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, projectId: string) {
    await this.deps.projectAccess.authorize(actorId, projectId, 'project:delete');
    await this.deps.uow.repos.projects.delete(projectId);
  }
}

export class ListProjectMembers {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, projectId: string): Promise<ProjectMember[]> {
    await this.deps.projectAccess.authorize(actorId, projectId, 'project:read');
    return this.deps.uow.repos.projectMembers.list(projectId);
  }
}

export class SetProjectMember {
  constructor(private readonly deps: Deps) {}

  /** Adds a workspace member to the project or changes their project role. */
  async execute(actorId: string, projectId: string, userId: string, role: ProjectRole) {
    const { project } = await this.deps.projectAccess.authorize(
      actorId,
      projectId,
      'project:manage-members',
    );
    const { members, projectMembers } = this.deps.uow.repos;
    if (!(await members.findRole(project.workspaceId, userId))) {
      throw notFound('member_not_found', 'That user is not a member of this workspace');
    }
    await projectMembers.upsert(projectId, userId, role);
  }
}

export class RemoveProjectMember {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, projectId: string, userId: string) {
    await this.deps.projectAccess.authorize(actorId, projectId, 'project:manage-members');
    if (!(await this.deps.uow.repos.projectMembers.remove(projectId, userId))) {
      throw notFound('member_not_found', 'That user is not a member of this project');
    }
  }
}

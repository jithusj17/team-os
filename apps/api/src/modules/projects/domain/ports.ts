import type { WorkspaceRole } from '@team-os/shared';
import type {
  NewStatus,
  Project,
  ProjectMember,
  ProjectRole,
  ProjectVisibility,
  Status,
} from './project.js';

/** Everything needed to decide a user's access to a project, fetched in one query. */
export interface ProjectAccessContext {
  project: Project;
  workspaceRole: WorkspaceRole | null;
  explicitRole: ProjectRole | null;
}

export interface ProjectRepository {
  findById(id: string): Promise<Project | null>;
  findAccessContext(projectId: string, userId: string): Promise<ProjectAccessContext | null>;
  findByKey(workspaceId: string, key: string): Promise<Project | null>;
  /** All projects in a workspace, with the user's explicit project role if any. */
  listWithExplicitRole(
    workspaceId: string,
    userId: string,
  ): Promise<(Project & { explicitRole: ProjectRole | null })[]>;
  /** Throws a `project_key_taken` conflict if the key is in use in the workspace. */
  create(data: Omit<Project, 'id' | 'createdAt'> & { createdBy: string }): Promise<Project>;
  update(
    id: string,
    patch: { name?: string; description?: string; visibility?: ProjectVisibility },
  ): Promise<Project | null>;
  delete(id: string): Promise<void>;
  /** Issues the next task number for the project. Must run inside a transaction. */
  nextTaskNumber(projectId: string): Promise<number>;
}

export interface ProjectMemberRepository {
  findRole(projectId: string, userId: string): Promise<ProjectRole | null>;
  list(projectId: string): Promise<ProjectMember[]>;
  upsert(projectId: string, userId: string, role: ProjectRole): Promise<void>;
  remove(projectId: string, userId: string): Promise<boolean>;
}

export interface StatusRepository {
  listForProject(projectId: string): Promise<Status[]>;
  findById(id: string): Promise<Status | null>;
  /** Throws a `status_name_taken` conflict on duplicate names within a project. */
  createMany(projectId: string, statuses: NewStatus[]): Promise<Status[]>;
  update(id: string, patch: Partial<Omit<NewStatus, 'position'>>): Promise<Status | null>;
  setPositions(projectId: string, orderedIds: string[]): Promise<void>;
  countTasks(statusId: string): Promise<number>;
  /** Moves the status's tasks to `targetStatusId` (if given), then deletes the status. */
  deleteAndReassign(statusId: string, targetStatusId: string | null): Promise<void>;
}

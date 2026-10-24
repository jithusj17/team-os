import { and, asc, eq, sql } from 'drizzle-orm';
import { isUniqueViolation, type DbExecutor } from '../../../infrastructure/db/executor.js';
import { projectMembers, projects, workspaceMembers } from '../../../infrastructure/db/schema.js';
import { conflict } from '../../../shared/domain/errors.js';
import type { Project, ProjectPatch } from '../domain/project.js';
import type { ProjectAccessContext, ProjectRepository } from '../domain/ports.js';

const columns = {
  id: projects.id,
  workspaceId: projects.workspaceId,
  key: projects.key,
  name: projects.name,
  description: projects.description,
  visibility: projects.visibility,
  enforceDependencies: projects.enforceDependencies,
  createdAt: projects.createdAt,
};

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly db: DbExecutor) {}

  async findById(id: string): Promise<Project | null> {
    const [row] = await this.db.select(columns).from(projects).where(eq(projects.id, id));
    return row ?? null;
  }

  async findAccessContext(projectId: string, userId: string): Promise<ProjectAccessContext | null> {
    const [row] = await this.db
      .select({
        project: columns,
        workspaceRole: workspaceMembers.role,
        explicitRole: projectMembers.role,
      })
      .from(projects)
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, projects.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .leftJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
      )
      .where(eq(projects.id, projectId));
    return row ?? null;
  }

  async findByKey(workspaceId: string, key: string): Promise<Project | null> {
    const [row] = await this.db
      .select(columns)
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.key, key.toUpperCase())));
    return row ?? null;
  }

  listWithExplicitRole(workspaceId: string, userId: string) {
    return this.db
      .select({ ...columns, explicitRole: projectMembers.role })
      .from(projects)
      .leftJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
      )
      .where(eq(projects.workspaceId, workspaceId))
      .orderBy(asc(projects.name));
  }

  async create(data: Omit<Project, 'id' | 'createdAt'> & { createdBy: string }) {
    try {
      const [row] = await this.db.insert(projects).values(data).returning(columns);
      return row!;
    } catch (err) {
      if (isUniqueViolation(err, 'projects_workspace_key')) {
        throw conflict(
          'project_key_taken',
          `The key ${data.key} is already used in this workspace`,
        );
      }
      throw err;
    }
  }

  async update(id: string, patch: ProjectPatch) {
    const [row] = await this.db
      .update(projects)
      .set(patch)
      .where(eq(projects.id, id))
      .returning(columns);
    return row ?? null;
  }

  async delete(id: string) {
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  async nextTaskNumber(projectId: string) {
    // The UPDATE takes a row lock, so concurrent creates get distinct, gap-free numbers.
    const [row] = await this.db
      .update(projects)
      .set({ taskCounter: sql`${projects.taskCounter} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ n: projects.taskCounter });
    return row!.n;
  }
}

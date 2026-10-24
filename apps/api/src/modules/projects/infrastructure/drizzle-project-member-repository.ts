import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { projectMembers, users } from '../../../infrastructure/db/schema.js';
import type { ProjectMember, ProjectRole } from '../domain/project.js';
import type { ProjectMemberRepository } from '../domain/ports.js';

const membership = (projectId: string, userId: string) =>
  and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId));

export class DrizzleProjectMemberRepository implements ProjectMemberRepository {
  constructor(private readonly db: DbExecutor) {}

  async findRole(projectId: string, userId: string): Promise<ProjectRole | null> {
    const [row] = await this.db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(membership(projectId, userId));
    return row?.role ?? null;
  }

  list(projectId: string): Promise<ProjectMember[]> {
    return this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(users.name));
  }

  async upsert(projectId: string, userId: string, role: ProjectRole) {
    await this.db
      .insert(projectMembers)
      .values({ projectId, userId, role })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { role },
      });
  }

  async remove(projectId: string, userId: string) {
    const rows = await this.db
      .delete(projectMembers)
      .where(membership(projectId, userId))
      .returning({ userId: projectMembers.userId });
    return rows.length > 0;
  }
}

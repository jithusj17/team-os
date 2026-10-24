import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { users, workspaceMembers } from '../../../infrastructure/db/schema.js';
import type { Member } from '../domain/membership.js';
import type { MemberRepository } from '../domain/ports.js';
import type { WorkspaceRole } from '../domain/workspace.js';

const membership = (workspaceId: string, userId: string) =>
  and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId));

export class DrizzleMemberRepository implements MemberRepository {
  constructor(private readonly db: DbExecutor) {}

  async findRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const [row] = await this.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(membership(workspaceId, userId));
    return row?.role ?? null;
  }

  list(workspaceId: string): Promise<Member[]> {
    return this.db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(asc(users.name));
  }

  async isMemberByEmail(workspaceId: string, email: string) {
    const [row] = await this.db
      .select({ userId: users.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, email)));
    return Boolean(row);
  }

  async add(workspaceId: string, userId: string, role: WorkspaceRole) {
    await this.db
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role })
      .onConflictDoNothing();
  }

  async updateRole(workspaceId: string, userId: string, role: WorkspaceRole) {
    await this.db.update(workspaceMembers).set({ role }).where(membership(workspaceId, userId));
  }

  async remove(workspaceId: string, userId: string) {
    await this.db.delete(workspaceMembers).where(membership(workspaceId, userId));
  }

  async lockOwnerIds(workspaceId: string) {
    const rows = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')))
      .for('update');
    return rows.map((r) => r.userId);
  }
}

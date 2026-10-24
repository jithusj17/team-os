import { asc, eq } from 'drizzle-orm';
import { isUniqueViolation, type DbExecutor } from '../../../infrastructure/db/executor.js';
import { workspaceMembers, workspaces } from '../../../infrastructure/db/schema.js';
import { conflict } from '../../../shared/domain/errors.js';
import type { WorkspaceRepository } from '../domain/ports.js';
import type { Workspace, WorkspaceView } from '../domain/workspace.js';

const columns = {
  id: workspaces.id,
  name: workspaces.name,
  slug: workspaces.slug,
  createdAt: workspaces.createdAt,
};

const slugTaken = () => conflict('slug_taken', 'That workspace URL is already taken');

export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: DbExecutor) {}

  async findById(id: string): Promise<Workspace | null> {
    const [row] = await this.db.select(columns).from(workspaces).where(eq(workspaces.id, id));
    return row ?? null;
  }

  listForUser(userId: string): Promise<WorkspaceView[]> {
    return this.db
      .select({ ...columns, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(asc(workspaces.name));
  }

  async create(data: { name: string; slug: string; createdBy: string }): Promise<Workspace> {
    try {
      const [row] = await this.db.insert(workspaces).values(data).returning(columns);
      return row!;
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) throw slugTaken();
      throw err;
    }
  }

  async update(id: string, patch: { name?: string; slug?: string }) {
    try {
      const [row] = await this.db
        .update(workspaces)
        .set(patch)
        .where(eq(workspaces.id, id))
        .returning(columns);
      return row ?? null;
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) throw slugTaken();
      throw err;
    }
  }

  async delete(id: string) {
    await this.db.delete(workspaces).where(eq(workspaces.id, id));
  }
}

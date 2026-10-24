import { asc, count, eq, sql } from 'drizzle-orm';
import { isUniqueViolation, type DbExecutor } from '../../../infrastructure/db/executor.js';
import { projectStatuses, tasks } from '../../../infrastructure/db/schema.js';
import { conflict } from '../../../shared/domain/errors.js';
import type { NewStatus, Status } from '../domain/project.js';
import type { StatusRepository } from '../domain/ports.js';

const columns = {
  id: projectStatuses.id,
  projectId: projectStatuses.projectId,
  name: projectStatuses.name,
  category: projectStatuses.category,
  color: projectStatuses.color,
  position: projectStatuses.position,
};

const nameTaken = () => conflict('status_name_taken', 'A status with that name already exists');

export class DrizzleStatusRepository implements StatusRepository {
  constructor(private readonly db: DbExecutor) {}

  listForProject(projectId: string): Promise<Status[]> {
    return this.db
      .select(columns)
      .from(projectStatuses)
      .where(eq(projectStatuses.projectId, projectId))
      .orderBy(asc(projectStatuses.position));
  }

  async findById(id: string): Promise<Status | null> {
    const [row] = await this.db
      .select(columns)
      .from(projectStatuses)
      .where(eq(projectStatuses.id, id));
    return row ?? null;
  }

  async createMany(projectId: string, statuses: NewStatus[]) {
    try {
      return await this.db
        .insert(projectStatuses)
        .values(statuses.map((s) => ({ ...s, projectId })))
        .returning(columns);
    } catch (err) {
      if (isUniqueViolation(err, 'project_statuses_name')) throw nameTaken();
      throw err;
    }
  }

  async update(id: string, patch: Partial<Omit<NewStatus, 'position'>>) {
    try {
      const [row] = await this.db
        .update(projectStatuses)
        .set(patch)
        .where(eq(projectStatuses.id, id))
        .returning(columns);
      return row ?? null;
    } catch (err) {
      if (isUniqueViolation(err, 'project_statuses_name')) throw nameTaken();
      throw err;
    }
  }

  async setPositions(projectId: string, orderedIds: string[]) {
    if (orderedIds.length === 0) return;
    // One UPDATE ... FROM (VALUES ...) instead of a query per status.
    const values = sql.join(
      orderedIds.map((id, i) => sql`(${id}::uuid, ${i}::int)`),
      sql`, `,
    );
    await this.db.execute(sql`
      update ${projectStatuses} set position = v.position
      from (values ${values}) as v(id, position)
      where ${projectStatuses.id} = v.id and ${projectStatuses.projectId} = ${projectId}
    `);
  }

  async countTasks(statusId: string) {
    const [row] = await this.db
      .select({ n: count() })
      .from(tasks)
      .where(eq(tasks.statusId, statusId));
    return row?.n ?? 0;
  }

  async deleteAndReassign(statusId: string, targetStatusId: string | null) {
    if (targetStatusId) {
      // Moved tasks go to the end of the target column, keeping their relative order.
      const [max] = await this.db
        .select({ max: sql<number>`coalesce(max(${tasks.sortOrder}), 0)` })
        .from(tasks)
        .where(eq(tasks.statusId, targetStatusId));
      await this.db
        .update(tasks)
        .set({
          statusId: targetStatusId,
          sortOrder: sql`${tasks.sortOrder} + ${max!.max} + 1024`,
          version: sql`${tasks.version} + 1`,
        })
        .where(eq(tasks.statusId, statusId));
    }
    await this.db.delete(projectStatuses).where(eq(projectStatuses.id, statusId));
  }
}

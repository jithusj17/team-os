import { and, asc, eq, inArray } from 'drizzle-orm';
import { isUniqueViolation, type DbExecutor } from '../../../infrastructure/db/executor.js';
import { labels } from '../../../infrastructure/db/schema.js';
import { conflict } from '../../../shared/domain/errors.js';
import type { Label } from '../domain/label.js';
import type { LabelRepository } from '../domain/ports.js';

const columns = { id: labels.id, name: labels.name, color: labels.color };
const inWorkspace = (workspaceId: string, id: string) =>
  and(eq(labels.workspaceId, workspaceId), eq(labels.id, id));
const labelExists = () => conflict('label_exists', 'A label with that name already exists');

export class DrizzleLabelRepository implements LabelRepository {
  constructor(private readonly db: DbExecutor) {}

  list(workspaceId: string): Promise<Label[]> {
    return this.db
      .select(columns)
      .from(labels)
      .where(eq(labels.workspaceId, workspaceId))
      .orderBy(asc(labels.name));
  }

  async findById(workspaceId: string, id: string) {
    const [row] = await this.db.select(columns).from(labels).where(inWorkspace(workspaceId, id));
    return row ?? null;
  }

  async existingIds(workspaceId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.workspaceId, workspaceId), inArray(labels.id, ids)));
    return rows.map((r) => r.id);
  }

  async create(workspaceId: string, data: Omit<Label, 'id'>) {
    try {
      const [row] = await this.db
        .insert(labels)
        .values({ ...data, workspaceId })
        .returning(columns);
      return row!;
    } catch (err) {
      if (isUniqueViolation(err, 'labels_workspace_name')) throw labelExists();
      throw err;
    }
  }

  async update(workspaceId: string, id: string, patch: Partial<Omit<Label, 'id'>>) {
    try {
      const [row] = await this.db
        .update(labels)
        .set(patch)
        .where(inWorkspace(workspaceId, id))
        .returning(columns);
      return row ?? null;
    } catch (err) {
      if (isUniqueViolation(err, 'labels_workspace_name')) throw labelExists();
      throw err;
    }
  }

  async delete(workspaceId: string, id: string) {
    const rows = await this.db
      .delete(labels)
      .where(inWorkspace(workspaceId, id))
      .returning({ id: labels.id });
    return rows.length > 0;
  }
}

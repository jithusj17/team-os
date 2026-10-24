import { asc, eq } from 'drizzle-orm';
import type { ActivityEntry } from '@team-os/shared';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { taskActivity } from '../../../infrastructure/db/schema.js';
import type { ActivityRepository } from '../domain/ports.js';
import type { FieldChanges } from '../domain/task.js';

export class DrizzleActivityRepository implements ActivityRepository {
  constructor(private readonly db: DbExecutor) {}

  async record(entry: {
    taskId: string;
    actorId: string;
    type: ActivityEntry['type'];
    changes?: FieldChanges | null;
    commentId?: string | null;
  }) {
    await this.db.insert(taskActivity).values({
      taskId: entry.taskId,
      actorId: entry.actorId,
      type: entry.type,
      changes: entry.changes ?? null,
      commentId: entry.commentId ?? null,
    });
  }

  async list(taskId: string): Promise<ActivityEntry[]> {
    const rows = await this.db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.taskId, taskId))
      .orderBy(asc(taskActivity.createdAt), asc(taskActivity.id));
    return rows.map((r) => ({ ...r, type: r.type as ActivityEntry['type'] }));
  }
}

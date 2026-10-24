import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { taskWatchers } from '../../../infrastructure/db/schema.js';
import type { WatcherRepository } from '../domain/ports.js';

export class DrizzleWatcherRepository implements WatcherRepository {
  constructor(private readonly db: DbExecutor) {}

  async add(taskId: string, userIds: string[]) {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    await this.db
      .insert(taskWatchers)
      .values(unique.map((userId) => ({ taskId, userId })))
      .onConflictDoNothing();
  }

  async remove(taskId: string, userId: string) {
    const rows = await this.db
      .delete(taskWatchers)
      .where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, userId)))
      .returning({ userId: taskWatchers.userId });
    return rows.length > 0;
  }

  async list(taskId: string) {
    const rows = await this.db
      .select({ userId: taskWatchers.userId })
      .from(taskWatchers)
      .where(eq(taskWatchers.taskId, taskId));
    return rows.map((r) => r.userId);
  }
}

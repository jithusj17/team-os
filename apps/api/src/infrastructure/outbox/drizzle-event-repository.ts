import { and, asc, eq, gt, min, sql } from 'drizzle-orm';
import type { WorkspaceEvent } from '@team-os/shared';
import type { EventRepository, NewEvent } from '../../shared/application/events.js';
import type { DbExecutor } from '../db/executor.js';
import { events, workspaces } from '../db/schema.js';

export const OUTBOX_CHANNEL = 'outbox';

export class DrizzleEventRepository implements EventRepository {
  constructor(private readonly db: DbExecutor) {}

  async append(event: NewEvent) {
    // Incrementing the workspace counter takes its row lock until commit, so a workspace's
    // events commit in seq order and readers never see seq N+1 before N.
    const [ws] = await this.db
      .update(workspaces)
      .set({ eventSeq: sql`${workspaces.eventSeq} + 1` })
      .where(eq(workspaces.id, event.workspaceId))
      .returning({ seq: workspaces.eventSeq });
    if (!ws) return; // the workspace is being deleted; nobody is left to notify

    await this.db.insert(events).values({
      workspaceId: event.workspaceId,
      seq: ws.seq,
      type: event.type,
      projectId: event.projectId ?? null,
      taskId: event.taskId ?? null,
      actorId: event.actorId,
      // Round-trip through JSON so Dates serialize the same way clients receive them.
      payload: JSON.parse(JSON.stringify(event.payload ?? null)),
    });
    // Postgres delivers NOTIFY only when the transaction commits: a free "after commit" hook.
    await this.db.execute(sql`select pg_notify(${OUTBOX_CHANNEL}, '')`);
  }

  async listSince(workspaceId: string, afterSeq: number, limit: number): Promise<WorkspaceEvent[]> {
    const rows = await this.db
      .select({
        workspaceId: events.workspaceId,
        seq: events.seq,
        type: events.type,
        projectId: events.projectId,
        taskId: events.taskId,
        actorId: events.actorId,
        payload: events.payload,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(and(eq(events.workspaceId, workspaceId), gt(events.seq, afterSeq)))
      .orderBy(asc(events.seq))
      .limit(limit);
    return rows as WorkspaceEvent[];
  }

  async latestSeq(workspaceId: string) {
    const [row] = await this.db
      .select({ seq: workspaces.eventSeq })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    return row?.seq ?? 0;
  }

  async oldestSeq(workspaceId: string) {
    const [row] = await this.db
      .select({ seq: min(events.seq) })
      .from(events)
      .where(eq(events.workspaceId, workspaceId));
    return row?.seq ?? null;
  }
}

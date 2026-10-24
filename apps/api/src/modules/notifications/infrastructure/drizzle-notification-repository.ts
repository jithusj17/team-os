import { and, desc, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import {
  notificationPreferences,
  notifications,
  users,
} from '../../../infrastructure/db/schema.js';
import { validation } from '../../../shared/domain/errors.js';
import type { Notification, NotificationDraft } from '../domain/notification.js';
import type { DigestBatch, NotificationRepository, StoredNotification } from '../domain/ports.js';

const columns = {
  id: notifications.id,
  userId: notifications.userId,
  type: notifications.type,
  workspaceId: notifications.workspaceId,
  projectId: notifications.projectId,
  taskId: notifications.taskId,
  actorId: notifications.actorId,
  data: notifications.data,
  readAt: notifications.readAt,
  createdAt: notifications.createdAt,
};

type Row = { [K in keyof typeof columns]: unknown };
const toStored = (row: Row) => row as unknown as StoredNotification;

const encodeCursor = (createdAt: string, id: string) =>
  Buffer.from(JSON.stringify([createdAt, id])).toString('base64url');

function decodeCursor(cursor: string): [string, string] {
  try {
    const [createdAt, id] = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as unknown[];
    if (typeof createdAt === 'string' && typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) {
      return [createdAt, id];
    }
  } catch {
    // fall through
  }
  throw validation('invalid_cursor', 'Invalid pagination cursor');
}

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly db: DbExecutor) {}

  async insertMany(drafts: NotificationDraft[]): Promise<StoredNotification[]> {
    if (drafts.length === 0) return [];
    const rows = await this.db
      .insert(notifications)
      .values(drafts)
      .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
      .returning(columns);
    return rows.map(toStored);
  }

  async list(userId: string, opts: { unreadOnly: boolean; cursor?: string; limit: number }) {
    const conds: SQL[] = [eq(notifications.userId, userId)];
    if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
    if (opts.cursor) {
      const [createdAt, id] = decodeCursor(opts.cursor);
      conds.push(
        sql`(${notifications.createdAt}, ${notifications.id}) < (${createdAt}::timestamptz, ${id}::uuid)`,
      );
    }
    const rows = await this.db
      .select({ ...columns, cursorAt: sql<string>`${notifications.createdAt}::text` })
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(opts.limit + 1);

    const page = rows.slice(0, opts.limit);
    const last = page.at(-1);
    return {
      items: page.map(({ cursorAt: _c, userId: _u, ...n }) => n as unknown as Notification),
      nextCursor: rows.length > opts.limit && last ? encodeCursor(last.cursorAt, last.id) : null,
    };
  }

  async unreadCount(userId: string) {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return row?.n ?? 0;
  }

  async markRead(userId: string, ids: string[] | 'all', now: Date) {
    const conds = [eq(notifications.userId, userId), isNull(notifications.readAt)];
    if (ids !== 'all') conds.push(inArray(notifications.id, ids));
    const rows = await this.db
      .update(notifications)
      .set({ readAt: now })
      .where(and(...conds))
      .returning({ id: notifications.id });
    return rows.length;
  }

  async digestBatches(since: Date): Promise<DigestBatch[]> {
    const actors = sql`actor`;
    const rows = await this.db
      .select({
        ...columns,
        email: users.email,
        name: users.name,
        actorName: sql<
          string | null
        >`(select ${actors}.name from users ${actors} where ${actors}.id = ${notifications.actorId})`,
      })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .leftJoin(notificationPreferences, eq(notificationPreferences.userId, notifications.userId))
      .where(
        and(
          isNull(notifications.readAt),
          isNull(notifications.emailedAt),
          gt(notifications.createdAt, since),
          // No preferences row means the defaults, which include the digest.
          sql`coalesce(${notificationPreferences.emailDigest}, true)`,
        ),
      )
      .orderBy(notifications.userId, desc(notifications.createdAt));

    const batches = new Map<string, DigestBatch>();
    for (const { email, name, actorName, ...n } of rows) {
      const stored = toStored(n);
      const batch = batches.get(stored.userId) ?? {
        userId: stored.userId,
        email,
        name,
        notifications: [],
      };
      batch.notifications.push({ ...stored, actorName });
      batches.set(stored.userId, batch);
    }
    return [...batches.values()];
  }

  async markEmailed(ids: string[], now: Date) {
    if (ids.length === 0) return;
    await this.db
      .update(notifications)
      .set({ emailedAt: now })
      .where(inArray(notifications.id, ids));
  }
}

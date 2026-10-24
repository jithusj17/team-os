import type { Logger } from 'pino';
import type { WorkspaceEvent } from '@team-os/shared';
import type { EventPublisher } from '../../modules/realtime/application/ports.js';
import type { Sql } from '../db/client.js';
import { OUTBOX_CHANNEL } from './drizzle-event-repository.js';

const RELAY_LOCK = 'team-os:outbox-relay';
const RETENTION_DAYS = 7;

interface EventRow {
  id: string;
  workspace_id: string;
  seq: string | number;
  type: WorkspaceEvent['type'];
  project_id: string | null;
  task_id: string | null;
  actor_id: string | null;
  payload: unknown;
  created_at: Date;
}

/**
 * Publishes committed outbox events, in seq order per workspace.
 *
 * - Exactly one relay is active at a time (a Postgres session advisory lock elects a leader),
 *   so events reach clients in order. Standby relays take over if the leader dies.
 * - It wakes on NOTIFY (sent when an event's transaction commits) and also polls, so a
 *   missed notification only delays delivery.
 * - Delivery is at-least-once: a crash between publishing and marking can resend a batch.
 *   Clients ignore events with a seq they've already applied.
 */
export class OutboxRelay {
  private leader: Awaited<ReturnType<Sql['reserve']>> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private unlisten: (() => Promise<void>) | null = null;
  private draining: Promise<void> | null = null;
  private drainAgain = false;
  private stopped = false;

  constructor(
    private readonly sql: Sql,
    private readonly publisher: EventPublisher,
    private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>,
    private readonly opts: { pollMs?: number; batchSize?: number } = {},
  ) {}

  async start() {
    const listener = await this.sql.listen(OUTBOX_CHANNEL, () => void this.kick());
    this.unlisten = () => listener.unlisten();
    const tick = () => void this.tick();
    this.timer = setInterval(tick, this.opts.pollMs ?? 1000);
    this.pruneTimer = setInterval(() => void this.prune(), 60 * 60 * 1000);
    await this.tick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    await this.unlisten?.();
    await this.draining;
    if (this.leader) {
      await this.leader`select pg_advisory_unlock(hashtext(${RELAY_LOCK}))`.catch(() => {});
      this.leader.release();
      this.leader = null;
    }
  }

  get isLeader() {
    return this.leader !== null;
  }

  private async tick() {
    if (this.stopped) return;
    try {
      if (!this.leader) await this.tryBecomeLeader();
      if (this.leader) await this.kick();
    } catch (err) {
      this.log.error({ err }, 'Outbox relay tick failed');
      this.leader?.release();
      this.leader = null; // the lock died with the connection; re-elect on the next tick
    }
  }

  private async tryBecomeLeader() {
    const conn = await this.sql.reserve();
    const [row] = await conn<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${RELAY_LOCK})) as locked
    `;
    if (row?.locked) {
      this.leader = conn;
      this.log.info('Outbox relay is now the leader');
    } else {
      conn.release();
    }
  }

  /** Drains now, or right after the drain already in progress. */
  async kick(): Promise<void> {
    if (!this.leader || this.stopped) return;
    if (this.draining) {
      this.drainAgain = true;
      return this.draining;
    }
    this.draining = (async () => {
      try {
        do {
          this.drainAgain = false;
          await this.drain();
        } while (this.drainAgain && !this.stopped);
      } finally {
        this.draining = null;
      }
    })();
    return this.draining;
  }

  /** Publishes all unpublished events. Returns how many were published. */
  async drain(): Promise<number> {
    const batchSize = this.opts.batchSize ?? 200;
    let total = 0;
    for (;;) {
      const rows = await this.sql<EventRow[]>`
        select id, workspace_id, seq, type, project_id, task_id, actor_id, payload, created_at
        from events where published_at is null
        order by workspace_id, seq
        limit ${batchSize}
      `;
      for (const row of rows) {
        await this.publisher.publish({
          workspaceId: row.workspace_id,
          seq: Number(row.seq),
          type: row.type,
          projectId: row.project_id,
          taskId: row.task_id,
          actorId: row.actor_id,
          payload: row.payload,
          createdAt: row.created_at,
        });
      }
      if (rows.length) {
        await this
          .sql`update events set published_at = now() where id = any(${rows.map((r) => r.id)}::uuid[])`;
      }
      total += rows.length;
      if (rows.length < batchSize) return total;
    }
  }

  /** Deletes published events past the retention window. Clients older than that resync fully. */
  async prune() {
    if (!this.leader) return;
    try {
      const result = await this.sql`
        delete from events
        where published_at is not null and created_at < now() - ${`${RETENTION_DAYS} days`}::interval
      `;
      if (result.count) this.log.info({ deleted: result.count }, 'Pruned old events');
    } catch (err) {
      this.log.error({ err }, 'Event pruning failed');
    }
  }
}

import { z } from 'zod';
import type { RedisClient } from '../../lib/redis.js';
import { hashToken, randomToken } from '../../lib/tokens.js';

const sessionRecord = z.object({
  userId: z.uuid(),
  csrfToken: z.string(),
  createdAt: z.number(),
  refreshedAt: z.number(),
});
export type Session = z.infer<typeof sessionRecord>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Server-side sessions in Redis. The cookie holds a random token; Redis holds
 * `sess:<sha256(token)>`. Sessions slide (idle timeout) up to an absolute maximum age.
 */
export class SessionStore {
  private readonly idleTtlSeconds: number;
  private readonly maxAgeMs: number;

  constructor(
    private readonly redis: RedisClient,
    opts: { idleTtlDays: number; maxAgeDays: number },
  ) {
    this.idleTtlSeconds = Math.round(opts.idleTtlDays * 24 * 60 * 60);
    this.maxAgeMs = opts.maxAgeDays * DAY_MS;
  }

  private key(token: string) {
    return `sess:${hashToken(token)}`;
  }

  async create(userId: string): Promise<{ token: string; session: Session }> {
    const token = randomToken();
    const now = Date.now();
    const session: Session = { userId, csrfToken: randomToken(), createdAt: now, refreshedAt: now };
    await this.redis.set(this.key(token), JSON.stringify(session), 'EX', this.idleTtlSeconds);
    return { token, session };
  }

  async get(token: string): Promise<Session | null> {
    const raw = await this.redis.get(this.key(token));
    if (!raw) return null;
    const parsed = sessionRecord.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      await this.destroy(token);
      return null;
    }
    const session = parsed.data;
    const now = Date.now();
    if (now - session.createdAt > this.maxAgeMs) {
      await this.destroy(token);
      return null;
    }
    // Extend the idle timeout at most once a day to avoid a write on every request.
    if (now - session.refreshedAt > DAY_MS) {
      session.refreshedAt = now;
      await this.redis.set(this.key(token), JSON.stringify(session), 'EX', this.idleTtlSeconds);
    }
    return session;
  }

  async destroy(token: string) {
    await this.redis.del(this.key(token));
  }
}

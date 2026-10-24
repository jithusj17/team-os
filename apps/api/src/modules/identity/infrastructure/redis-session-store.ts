import { z } from 'zod';
import type { RedisClient } from '../../../infrastructure/redis.js';
import type { TokenService } from '../../../shared/application/ports.js';
import type { Session, SessionStore } from '../domain/ports.js';

const sessionRecord = z.object({
  userId: z.uuid(),
  csrfToken: z.string(),
  createdAt: z.number(),
  refreshedAt: z.number(),
});
type SessionRecord = z.infer<typeof sessionRecord>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sessions in Redis. The cookie holds a random token; Redis holds `sess:<hash(token)>`.
 * Sessions slide (idle timeout) up to an absolute maximum age.
 */
export class RedisSessionStore implements SessionStore {
  private readonly idleTtlSeconds: number;
  private readonly maxAgeMs: number;

  constructor(
    private readonly redis: RedisClient,
    private readonly tokens: TokenService,
    opts: { idleTtlDays: number; maxAgeDays: number },
  ) {
    this.idleTtlSeconds = Math.round(opts.idleTtlDays * 24 * 60 * 60);
    this.maxAgeMs = opts.maxAgeDays * DAY_MS;
  }

  private key(token: string) {
    return `sess:${this.tokens.hash(token)}`;
  }

  private async write(token: string, record: SessionRecord) {
    await this.redis.set(this.key(token), JSON.stringify(record), 'EX', this.idleTtlSeconds);
  }

  async create(userId: string) {
    const token = this.tokens.generate();
    const now = Date.now();
    const record = { userId, csrfToken: this.tokens.generate(), createdAt: now, refreshedAt: now };
    await this.write(token, record);
    return { token, session: { userId, csrfToken: record.csrfToken } };
  }

  async get(token: string): Promise<Session | null> {
    const raw = await this.redis.get(this.key(token));
    if (!raw) return null;
    const parsed = sessionRecord.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      await this.destroy(token);
      return null;
    }
    const record = parsed.data;
    const now = Date.now();
    if (now - record.createdAt > this.maxAgeMs) {
      await this.destroy(token);
      return null;
    }
    // Extend the idle timeout at most once a day to avoid a write on every request.
    if (now - record.refreshedAt > DAY_MS) await this.write(token, { ...record, refreshedAt: now });
    return { userId: record.userId, csrfToken: record.csrfToken };
  }

  async destroy(token: string) {
    await this.redis.del(this.key(token));
  }
}

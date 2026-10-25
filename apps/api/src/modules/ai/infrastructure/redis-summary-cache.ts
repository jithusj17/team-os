import type { RedisClient } from '../../../infrastructure/redis.js';
import type { SummaryCache } from '../domain/ports.js';

/** Keys embed the content hash, so stale entries are never read; the TTL just reclaims them. */
const TTL_SECONDS = 7 * 24 * 60 * 60;

export class RedisSummaryCache implements SummaryCache {
  constructor(private readonly redis: RedisClient) {}

  get(key: string) {
    return this.redis.get(key);
  }

  async set(key: string, text: string) {
    await this.redis.set(key, text, 'EX', TTL_SECONDS);
  }
}

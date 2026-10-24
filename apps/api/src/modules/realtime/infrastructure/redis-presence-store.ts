import type { RedisClient } from '../../../infrastructure/redis.js';
import { PRESENCE_TTL_SECONDS } from '../domain/rooms.js';
import type { PresenceStore } from '../application/ports.js';

/**
 * One Redis hash per room: field = connection id, value = { userId, at }. Entries older than
 * the TTL are ignored and cleaned up lazily, so crashed instances can't leave ghosts behind.
 */
export class RedisPresenceStore implements PresenceStore {
  constructor(private readonly redis: RedisClient) {}

  private key(room: string) {
    return `presence:${room}`;
  }

  async enter(room: string, connectionId: string, userId: string) {
    const key = this.key(room);
    await this.redis
      .multi()
      .hset(key, connectionId, JSON.stringify({ userId, at: Date.now() }))
      .expire(key, PRESENCE_TTL_SECONDS * 2)
      .exec();
  }

  async leave(room: string, connectionId: string) {
    await this.redis.hdel(this.key(room), connectionId);
  }

  async userIds(room: string) {
    const key = this.key(room);
    const entries = await this.redis.hgetall(key);
    const cutoff = Date.now() - PRESENCE_TTL_SECONDS * 1000;
    const live = new Set<string>();
    const stale: string[] = [];
    for (const [connectionId, raw] of Object.entries(entries)) {
      const entry = JSON.parse(raw) as { userId: string; at: number };
      if (entry.at >= cutoff) live.add(entry.userId);
      else stale.push(connectionId);
    }
    if (stale.length) await this.redis.hdel(key, ...stale);
    return [...live].sort();
  }
}

import { Redis } from 'ioredis';

export function createRedis(url: string) {
  return new Redis(url, {
    // Fail commands fast instead of queueing forever when Redis is down,
    // so health checks and requests report errors promptly.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
}

export type RedisClient = Redis;

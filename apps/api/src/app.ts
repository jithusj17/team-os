import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { createDb, type Db, type Sql } from './db/client.js';
import { createRedis, type RedisClient } from './lib/redis.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    sql: Sql;
    redis: RedisClient;
  }
}

function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  if (config.NODE_ENV === 'test') return false;
  return {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    ...(config.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    }),
  };
}

export async function buildApp(config: Config) {
  const app = Fastify({
    logger: loggerOptions(config),
    // Honour an incoming request ID (e.g. from a proxy) so logs correlate across services.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: true,
  });

  const { db, sql } = createDb(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);
  await redis.connect().catch((err: unknown) => app.log.error({ err }, 'Redis connection failed'));

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('sql', sql);
  app.decorate('redis', redis);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.addHook('onClose', async () => {
    await Promise.allSettled([sql.end({ timeout: 5 }), redis.quit()]);
  });

  await app.register(healthRoutes);

  return app;
}

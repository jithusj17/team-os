import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { createDb, type Db, type Sql } from './db/client.js';
import { registerErrorHandlers } from './lib/errors.js';
import { Queues } from './lib/queues.js';
import { createRedis, type RedisClient } from './lib/redis.js';
import { authPlugin } from './modules/auth/plugin.js';
import { providersFromConfig, type OAuthProvider } from './modules/auth/providers.js';
import { authRoutes } from './modules/auth/routes.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    sql: Sql;
    redis: RedisClient;
    queues: Queues;
  }
}

export interface BuildAppOptions {
  /** Overrides the providers derived from config (used by tests). */
  oauthProviders?: OAuthProvider[];
}

function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  if (config.NODE_ENV === 'test') return false;
  return {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]'],
    ...(config.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    }),
  };
}

export async function buildApp(config: Config, options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: loggerOptions(config),
    // Honour an incoming request ID (e.g. from a proxy) so logs correlate across services.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);

  const { db, sql } = createDb(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);
  await redis.connect().catch((err: unknown) => app.log.error({ err }, 'Redis connection failed'));
  const queues = new Queues(config.REDIS_URL, app.log);

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('sql', sql);
  app.decorate('redis', redis);
  app.decorate('queues', queues);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.addHook('onClose', async () => {
    await queues.close();
    await Promise.allSettled([sql.end({ timeout: 5 }), redis.quit()]);
  });

  // Order matters: sessions load before rate limiting so limits can be keyed per user.
  await app.register(authPlugin);
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    redis,
    nameSpace: 'rl:',
    // A Redis outage should degrade rate limiting, not take the whole API down.
    skipOnError: true,
    keyGenerator: (req) => (req.auth ? `user:${req.auth.userId}` : `ip:${req.ip}`),
    allowList: (req) => req.url.startsWith('/health'),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: ctx.statusCode,
      code: 'rate_limited',
      message: `Too many requests. Try again in ${ctx.after}.`,
    }),
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, {
    providers: options.oauthProviders ?? providersFromConfig(config),
  });
  await app.register(workspaceRoutes);

  return app;
}

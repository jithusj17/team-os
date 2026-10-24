import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { createContainer, type Container } from './container.js';
import { authPlugin, requireAuth } from './http/auth.plugin.js';
import { registerErrorHandlers } from './http/error-handler.js';
import { healthRoutes } from './http/health.routes.js';
import { createDb, type Sql } from './infrastructure/db/client.js';
import { createRedis, type RedisClient } from './infrastructure/redis.js';
import type { OAuthProvider } from './modules/identity/domain/ports.js';
import { authRoutes } from './modules/identity/http/auth.routes.js';
import { attachRealtime } from './http/realtime.js';
import { projectRoutes } from './modules/projects/http/projects.routes.js';
import { notificationRoutes } from './modules/notifications/http/notifications.routes.js';
import { eventRoutes } from './modules/realtime/http/events.routes.js';
import { taskRoutes } from './modules/tasks/http/tasks.routes.js';
import { workspaceRoutes } from './modules/workspaces/http/workspaces.routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    container: Container;
    /** Raw connections, used only by health checks and tests. */
    sql: Sql;
    redis: RedisClient;
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
  const container = createContainer({
    config,
    db,
    redis,
    log: app.log,
    oauthProviders: options.oauthProviders,
  });

  app.decorate('config', config);
  app.decorate('container', container);
  app.decorate('sql', sql);
  app.decorate('redis', redis);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.addHook('onClose', async () => {
    await container.close();
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
  await app.register(authRoutes);
  await app.register(workspaceRoutes);
  await app.register(projectRoutes);
  await app.register(taskRoutes);
  await app.register(notificationRoutes);
  await app.register(async (scoped) => {
    scoped.addHook('onRequest', async (req) => {
      requireAuth(req);
    });
    await scoped.register(eventRoutes);
  });

  await attachRealtime(app);

  return app;
}

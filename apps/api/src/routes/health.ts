import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@team-os/shared';

async function check(fn: () => Promise<unknown>): Promise<'ok' | 'error'> {
  try {
    await fn();
    return 'ok';
  } catch {
    return 'error';
  }
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Liveness: the process is up. Used by orchestrators to decide restarts.
  app.get('/health/live', async () => ({ status: 'ok' }));

  // Readiness: dependencies reachable. Returns 503 so load balancers stop routing traffic.
  app.get('/health', async (_req, reply) => {
    const [database, redis] = await Promise.all([
      check(() => app.sql`select 1`),
      check(() => app.redis.ping()),
    ]);
    const body: HealthResponse = {
      status: database === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, redis },
    };
    return reply.code(body.status === 'ok' ? 200 : 503).send(body);
  });
};

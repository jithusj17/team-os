import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { z } from 'zod';
import { QUEUES } from '@team-os/shared';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.string().default('info'),
    REDIS_URL: z.url(),
  })
  .parse(process.env);

const log = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
});

// BullMQ workers use blocking commands, so they require maxRetriesPerRequest: null.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const workers = [
  new Worker(
    QUEUES.system,
    async (job) => {
      log.info({ jobId: job.id, name: job.name }, 'system job');
    },
    { connection },
  ),
];

for (const worker of workers) {
  worker.on('failed', (job, err) =>
    log.error(
      { queue: worker.name, jobId: job?.id, attempts: job?.attemptsMade, err },
      'Job failed',
    ),
  );
  worker.on('error', (err) => log.error({ queue: worker.name, err }, 'Worker error'));
}

log.info({ queues: workers.map((w) => w.name) }, 'Worker started');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'Shutting down worker');
  // close() waits for in-flight jobs to finish so they aren't left half-done.
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

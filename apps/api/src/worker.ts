import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { emailJob, QUEUES } from '@team-os/shared';
import { loadConfig } from './config.js';
import { createDb } from './infrastructure/db/client.js';
import { OutboxRelay } from './infrastructure/outbox/outbox-relay.js';
import { SocketIoEventPublisher } from './modules/realtime/infrastructure/socket-io-event-publisher.js';

// The worker process: background jobs and the outbox relay. Same codebase as the API server,
// different entry point, so both share the domain and infrastructure layers.

const config = loadConfig();
const log = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
});

const { sql } = createDb(config.DATABASE_URL);
// BullMQ workers use blocking commands, so they require maxRetriesPerRequest: null.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const emitterRedis = new Redis(config.REDIS_URL);

const relay = new OutboxRelay(sql, new SocketIoEventPublisher(emitterRedis), log);

const workers = [
  new Worker(
    QUEUES.email,
    async (job) => {
      const email = emailJob.parse(job.data);
      // No email provider is configured yet (see SPEC.md open questions), so delivery is
      // logged. Swap this for the real provider call; retries/backoff are already in place.
      log.info(
        { jobId: job.id, type: email.type, to: email.to, acceptUrl: email.acceptUrl },
        'Email not sent: no provider configured',
      );
    },
    { connection, concurrency: 5 },
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

await relay.start();
log.info({ queues: workers.map((w) => w.name) }, 'Worker started');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'Shutting down worker');
  // close() waits for in-flight jobs to finish so they aren't left half-done.
  await Promise.all([relay.stop(), ...workers.map((w) => w.close())]);
  await Promise.allSettled([connection.quit(), emitterRedis.quit(), sql.end({ timeout: 5 })]);
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

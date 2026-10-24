import { Redis } from 'ioredis';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { createDb } from './infrastructure/db/client.js';
import { OutboxRelay } from './infrastructure/outbox/outbox-relay.js';
import {
  BullMqEventPublisher,
  CompositeEventPublisher,
} from './infrastructure/queues/bullmq-event-publisher.js';
import { startWorkers } from './jobs/workers.js';
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

const { db, sql } = createDb(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL);
// BullMQ workers use blocking commands, so they require maxRetriesPerRequest: null.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const container = createContainer({ config, db, redis, log });
const relay = new OutboxRelay(
  sql,
  // Sockets first, so people see changes before background reactions (notifications) land.
  new CompositeEventPublisher([
    new SocketIoEventPublisher(redis),
    new BullMqEventPublisher(container.jobs),
  ]),
  log,
);

const workers = await startWorkers({ container, connection, log });
await relay.start();
log.info({ queues: workers.workers.map((w) => w.name) }, 'Worker started');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'Shutting down worker');
  // Stop taking new work, let in-flight jobs finish, then release connections.
  await Promise.all([relay.stop(), workers.close()]);
  await container.close();
  await Promise.allSettled([connection.quit(), redis.quit(), sql.end({ timeout: 5 })]);
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

import { Queue, Worker, type Job, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  emailJob,
  QUEUES,
  searchIndexJob,
  workspaceEvent,
  type DeadLetterJob,
} from '@team-os/shared';
import type { Container } from '../container.js';

// The job interface layer: like http/, it only parses input and calls use cases.

type Log = Pick<Logger, 'info' | 'warn' | 'error'>;

/** Schedules for recurring jobs on the notifications queue. */
export const SCHEDULES = {
  dueSoon: { id: 'due-soon', repeat: { every: 60 * 60 * 1000 } },
  digest: { id: 'email-digest', repeat: { pattern: '0 8 * * *', tz: 'UTC' } },
} as const;

/**
 * Moves a job to the dead-letter queue once it has failed every retry, with its error, so it
 * can be inspected and replayed instead of disappearing into a log line.
 */
export function attachDeadLetter(worker: Worker, deadLetter: Queue, log: Log) {
  worker.on('failed', (job: Job | undefined, err: Error) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      log.warn(
        { queue: worker.name, jobId: job.id, attempt: job.attemptsMade, err },
        'Job failed; will retry',
      );
      return;
    }
    log.error(
      { queue: worker.name, jobId: job.id, err },
      'Job failed permanently; moved to dead-letter queue',
    );
    const entry: DeadLetterJob = {
      queue: worker.name,
      jobName: job.name,
      jobId: job.id,
      data: job.data,
      failedReason: err.message,
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    };
    void deadLetter
      .add(job.name, entry)
      .catch((e: unknown) => log.error({ err: e }, 'Dead-lettering failed'));
  });
  worker.on('error', (err) => log.error({ queue: worker.name, err }, 'Worker error'));
}

export async function startWorkers(deps: { container: Container; connection: Redis; log: Log }) {
  const { container, connection, log } = deps;
  const deadLetter = new Queue(QUEUES.deadLetter, { connection });

  const processors: [string, Processor, number][] = [
    [
      QUEUES.domainEvents,
      async (job) => {
        const event = workspaceEvent.parse(job.data);
        const sent = await container.notifications.fanOut.execute(event);
        await container.search.scheduleIndexing.execute(event);
        return { notifications: sent.length };
      },
      10,
    ],
    [
      QUEUES.searchIndex,
      async (job) => ({
        result: await container.search.indexSource.execute(searchIndexJob.parse(job.data)),
      }),
      // Embedding calls are rate-limited by the provider; a few at a time is plenty.
      3,
    ],
    [
      QUEUES.notifications,
      async (job) => {
        if (job.name === SCHEDULES.dueSoon.id) {
          return {
            reminders: (await container.notifications.sendDueSoonReminders.execute()).length,
          };
        }
        if (job.name === SCHEDULES.digest.id) {
          return { digests: await container.notifications.sendEmailDigests.execute() };
        }
        throw new Error(`Unknown notifications job: ${job.name}`);
      },
      1,
    ],
    [
      QUEUES.email,
      async (job) => {
        const email = emailJob.parse(job.data);
        // No email provider is configured yet (see SPEC.md open questions), so delivery is
        // logged. Swap this for the real provider call; retries/backoff are already in place.
        log.info(
          { jobId: job.id, type: email.type, to: email.to },
          'Email not sent: no provider configured',
        );
      },
      5,
    ],
  ];

  const workers = processors.map(([name, processor, concurrency]) => {
    const worker = new Worker(name, processor, { connection, concurrency });
    attachDeadLetter(worker, deadLetter, log);
    return worker;
  });

  // Idempotent: re-running on every start updates the schedule instead of duplicating it.
  const notifications = container.jobs.queue(QUEUES.notifications);
  for (const { id, repeat } of Object.values(SCHEDULES)) {
    await notifications.upsertJobScheduler(id, repeat, { name: id });
  }

  return {
    workers,
    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await deadLetter.close();
    },
  };
}

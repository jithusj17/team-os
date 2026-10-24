import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { QUEUES, type EmailJob, type QueueName, type SearchIndexJob } from '@team-os/shared';
import type { JobQueue } from '../../shared/application/ports.js';

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

/** BullMQ implementation of the job queue port. Queues are created lazily on first use. */
export class BullMqJobQueue implements JobQueue {
  private readonly queues = new Map<QueueName, Queue>();
  private connection: Redis | null = null;

  constructor(
    private readonly redisUrl: string,
    private readonly log: Pick<Logger, 'error'>,
  ) {}

  private get(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      this.connection ??= new Redis(this.redisUrl, { maxRetriesPerRequest: null });
      queue = new Queue(name, { connection: this.connection, defaultJobOptions });
      queue.on('error', (err) => this.log.error({ err, queue: name }, 'Queue error'));
      this.queues.set(name, queue);
    }
    return queue;
  }

  async sendEmail(job: EmailJob) {
    await this.get(QUEUES.email).add(job.type, job);
  }

  async indexForSearch(job: SearchIndexJob) {
    const id =
      job.kind === 'source' ? `${job.sourceType}_${job.sourceId}` : `project_${job.projectId}`;
    await this.get(QUEUES.searchIndex).add(job.kind, job, {
      jobId: id,
      delay: 1500,
      // A completed job must not keep its id, or later edits to the same source would be ignored.
      removeOnComplete: true,
    });
  }

  /** Exposed for tests and admin tooling. */
  queue(name: QueueName) {
    return this.get(name);
  }

  async close() {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    await this.connection?.quit().catch(() => {});
  }
}

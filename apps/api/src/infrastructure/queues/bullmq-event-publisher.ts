import { QUEUES, type WorkspaceEvent } from '@team-os/shared';
import type { EventPublisher } from '../../modules/realtime/application/ports.js';
import type { BullMqJobQueue } from './bullmq-job-queue.js';

/**
 * Hands every committed event to background workers (notifications now, search indexing later).
 * The job id is the event's identity, so a relay retry doesn't enqueue the same event twice.
 */
export class BullMqEventPublisher implements EventPublisher {
  constructor(private readonly jobs: BullMqJobQueue) {}

  async publish(event: WorkspaceEvent) {
    await this.jobs.queue(QUEUES.domainEvents).add(event.type, event, {
      jobId: `${event.workspaceId}_${event.seq}`, // BullMQ forbids ":" in custom ids
    });
  }
}

/** Publishes to several destinations in order (e.g. sockets, then background jobs). */
export class CompositeEventPublisher implements EventPublisher {
  constructor(private readonly publishers: EventPublisher[]) {}

  async publish(event: WorkspaceEvent) {
    for (const publisher of this.publishers) await publisher.publish(event);
  }
}

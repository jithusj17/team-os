import { z } from 'zod';
import { workspaceRole } from './schemas.js';

// Queue names and job payloads shared by the API (producer) and the worker (consumer).
export const QUEUES = {
  /** Every committed workspace event, for background reactions (notifications, indexing). */
  domainEvents: 'domain-events',
  /** Scheduled notification jobs: due-soon reminders and email digests. */
  notifications: 'notifications',
  email: 'email',
  /** Jobs that failed every retry, kept with their error for inspection and replay. */
  deadLetter: 'dead-letter',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const emailJob = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('workspace-invite'),
    to: z.email(),
    workspaceName: z.string(),
    inviterName: z.string(),
    role: workspaceRole,
    acceptUrl: z.url(),
    expiresAt: z.iso.datetime(),
  }),
  z.object({
    type: z.literal('notification-digest'),
    to: z.email(),
    name: z.string(),
    items: z.array(z.object({ text: z.string(), url: z.url() })).min(1),
  }),
]);
export type EmailJob = z.infer<typeof emailJob>;

export const deadLetterJob = z.object({
  queue: z.string(),
  jobName: z.string(),
  jobId: z.string().optional(),
  data: z.unknown(),
  failedReason: z.string(),
  attemptsMade: z.number().int(),
  failedAt: z.iso.datetime(),
});
export type DeadLetterJob = z.infer<typeof deadLetterJob>;

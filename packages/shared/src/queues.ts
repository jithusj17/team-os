import { z } from 'zod';
import { workspaceRole } from './schemas.js';

// Queue names and job payloads shared by the API (producer) and the worker (consumer).
export const QUEUES = {
  email: 'email',
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
]);
export type EmailJob = z.infer<typeof emailJob>;

// Queue names shared by the API (producer) and the worker (consumer).
// Job payload schemas are added here as each queue is introduced.
export const QUEUES = {
  system: 'system',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

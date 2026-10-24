import { z } from 'zod';

export const dependencyStatus = z.enum(['ok', 'error']);

export const healthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number(),
  checks: z.object({
    database: dependencyStatus,
    redis: dependencyStatus,
  }),
});

export type HealthResponse = z.infer<typeof healthResponse>;

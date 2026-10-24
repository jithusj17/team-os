import { describe, expect, it } from 'vitest';
import { healthResponse } from './health.js';

describe('healthResponse', () => {
  it('rejects unknown dependency states', () => {
    const result = healthResponse.safeParse({
      status: 'ok',
      uptimeSeconds: 1,
      checks: { database: 'maybe', redis: 'ok' },
    });
    expect(result.success).toBe(false);
  });
});

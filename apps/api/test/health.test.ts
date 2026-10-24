import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { healthResponse } from '@team-os/shared';
import { buildTestApp } from './helpers.js';

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(() => app.close());

  it('reports ok when database and redis are reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = healthResponse.parse(res.json());
    expect(body.checks).toEqual({ database: 'ok', redis: 'ok' });
  });

  it('echoes the incoming request id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});

describe('GET /health with redis down', () => {
  it('returns 503 and marks redis as error', async () => {
    const app = await buildTestApp({ REDIS_URL: 'redis://localhost:1' });
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(503);
      expect(healthResponse.parse(res.json()).checks).toEqual({ database: 'ok', redis: 'error' });
    } finally {
      await app.close();
    }
  });
});

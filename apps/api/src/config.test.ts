import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://a@b/c', REDIS_URL: 'redis://x' });
    expect(config.API_PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('development');
  });

  it('throws a readable error when required vars are missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});

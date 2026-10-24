import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL:
      process.env.TEST_DATABASE_URL ?? 'postgres://teamos:teamos@localhost:5433/teamos_test',
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/1',
    ...overrides,
  });
}

export function buildTestApp(overrides: Record<string, string> = {}) {
  return buildApp(testConfig(overrides));
}

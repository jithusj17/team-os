import { runMigrations } from '../src/infrastructure/db/migrate.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://teamos:teamos@localhost:5433/teamos_test';

export async function setup() {
  await runMigrations(TEST_DATABASE_URL);
}

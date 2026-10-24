import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../drizzle',
);

export async function runMigrations(url: string) {
  const { db, sql } = createDb(url);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  await runMigrations(url);
  console.log('Migrations applied');
}

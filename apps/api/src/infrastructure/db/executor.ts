import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema.js';

/** Either the database or an open transaction. Repositories accept both. */
export type DbExecutor = PgDatabase<PgQueryResultHKT, typeof schema>;

const UNIQUE_VIOLATION = '23505';

/** True if `err` is a Postgres unique violation, optionally on a constraint matching `constraint`. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  // Drizzle wraps driver errors; the Postgres error is on `cause`.
  const pg = ((err as { cause?: unknown }).cause ?? err) as {
    code?: string;
    constraint_name?: string;
  };
  return (
    pg.code === UNIQUE_VIOLATION &&
    (!constraint || Boolean(pg.constraint_name?.includes(constraint)))
  );
}

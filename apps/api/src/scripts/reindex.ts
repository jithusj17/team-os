import { pino } from 'pino';
import { loadConfig } from '../config.js';
import { createContainer } from '../container.js';
import { createDb } from '../infrastructure/db/client.js';
import { createRedis } from '../infrastructure/redis.js';

// Rebuilds the search index for everything (e.g. after enabling embeddings). Runs inline so
// it works without the worker; already-indexed, unchanged sources are skipped cheaply.

const config = loadConfig();
const { db, sql } = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
await redis.connect();
const c = createContainer({ config, db, redis, log: pino({ level: 'warn' }) });

const sources = await sql<{ type: 'task' | 'comment' | 'doc' | 'meeting'; id: string }[]>`
  select 'task' as type, id from tasks
  union all select 'comment', id from comments
  union all select 'doc', id from docs
  union all select 'meeting', id from meetings
`;
const counts = { indexed: 0, unchanged: 0, removed: 0 };
for (const s of sources) {
  const result = await c.search.indexSource.execute({
    kind: 'source',
    sourceType: s.type,
    sourceId: s.id,
  });
  counts[result]++;
}
console.log(
  `Reindexed ${sources.length} sources:`,
  counts,
  c.search.embeddings.enabled ? '(with embeddings)' : '(keyword only)',
);
await c.close();
await redis.quit();
await sql.end();

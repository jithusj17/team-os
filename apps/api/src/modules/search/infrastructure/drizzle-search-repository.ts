import { and, eq, sql, type SQL } from 'drizzle-orm';
import { HIGHLIGHT_END, HIGHLIGHT_START, type SearchSourceType } from '@team-os/shared';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { searchIndex } from '../../../infrastructure/db/schema.js';
import type { SearchHit, SearchIndexRepository, SearchScope } from '../domain/ports.js';
import type { IndexableSource } from '../domain/search.js';

const uuidArray = (ids: string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;
const vectorLiteral = (v: number[]) => sql`${`[${v.join(',')}]`}::vector`;

/**
 * Who may see a row, enforced inside every search query: rows in projects the user can see,
 * workspace-level rows for non-guests, and rows that list the user explicitly.
 */
function accessFilter(s: SearchScope): SQL {
  const types = s.types?.length
    ? sql`and source_type = any(${`{${s.types.join(',')}}`}::text[])`
    : sql``;
  return sql`workspace_id = ${s.workspaceId}::uuid ${types} and (
    (project_id is null and ${!s.isGuest})
    or project_id = any(${uuidArray(s.visibleProjectIds)})
    or ${s.userId}::uuid = any(allowed_user_ids)
  )`;
}

type Row = {
  source_type: SearchSourceType;
  source_id: string;
  project_id: string | null;
  task_id: string | null;
  title: string;
  snippet: string;
  content: string;
};

const toHit = (r: Row): SearchHit => ({
  sourceType: r.source_type,
  sourceId: r.source_id,
  projectId: r.project_id,
  taskId: r.task_id,
  title: r.title,
  snippet: r.snippet,
  content: r.content,
});

export class DrizzleSearchRepository implements SearchIndexRepository {
  constructor(private readonly db: DbExecutor) {}

  // The executor type is driver-agnostic; postgres-js returns raw-query rows as an array.
  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.db.execute(query)) as unknown as T[];
  }

  async currentHash(sourceType: SearchSourceType, sourceId: string) {
    const [row] = await this.db
      .select({ hash: searchIndex.contentHash })
      .from(searchIndex)
      .where(and(eq(searchIndex.sourceType, sourceType), eq(searchIndex.sourceId, sourceId)))
      .limit(1);
    return row?.hash ?? null;
  }

  async replace(
    source: Omit<IndexableSource, 'title' | 'content'> & { hash: string },
    chunks: { title: string; content: string; embedding: number[] | null }[],
  ) {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(searchIndex)
        .where(
          and(
            eq(searchIndex.sourceType, source.sourceType),
            eq(searchIndex.sourceId, source.sourceId),
          ),
        );
      await tx.insert(searchIndex).values(
        chunks.map((chunk, chunkIndex) => ({
          workspaceId: source.workspaceId,
          projectId: source.projectId,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          taskId: source.taskId,
          allowedUserIds: source.allowedUserIds,
          contentHash: source.hash,
          chunkIndex,
          ...chunk,
        })),
      );
    });
  }

  async deleteSource(sourceType: SearchSourceType, sourceId: string) {
    await this.db
      .delete(searchIndex)
      .where(and(eq(searchIndex.sourceType, sourceType), eq(searchIndex.sourceId, sourceId)));
  }

  async deleteTask(taskId: string) {
    await this.db.delete(searchIndex).where(eq(searchIndex.taskId, taskId));
  }

  async deleteProject(projectId: string) {
    await this.db.delete(searchIndex).where(eq(searchIndex.projectId, projectId));
  }

  async keyword(scope: SearchScope, query: { prefix: string; text: string }): Promise<SearchHit[]> {
    const options = `MaxWords=28, MinWords=10, MaxFragments=1, StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}`;
    // Best-matching chunk per source first; highlights are computed only for the final page.
    const rows = await this.rows<Row>(sql`
      -- Exact-word prefixes ("sett:*" ~ "settings") or stemmed whole words ("bills" ~ "billing").
      with q as (
        select to_tsquery('simple', ${query.prefix}) || websearch_to_tsquery('english', ${query.text}) as q
      ),
      best as (
        select distinct on (source_type, source_id) id, ts_rank_cd(tsv, q.q) as rank
        from search_index, q
        where tsv @@ q.q and ${accessFilter(scope)}
        order by source_type, source_id, rank desc
      ),
      top as (select id, rank from best order by rank desc limit ${scope.limit})
      select s.source_type, s.source_id, s.project_id, s.task_id, s.title,
        ts_headline('english', s.content, q.q, ${options}) as snippet, s.content
      from top join search_index s on s.id = top.id cross join q
      order by top.rank desc
    `);
    return rows.map(toHit);
  }

  async semantic(
    scope: SearchScope,
    embedding: number[],
    minSimilarity: number,
  ): Promise<SearchHit[]> {
    // Nearest chunks via the HNSW index, then keep each source's closest chunk.
    const rows = await this.rows<Row>(sql`
      select source_type, source_id, project_id, task_id, title, left(content, 240) as snippet, content
      from search_index
      where embedding is not null and ${accessFilter(scope)}
        and embedding <=> ${vectorLiteral(embedding)} < ${1 - minSimilarity}
      order by embedding <=> ${vectorLiteral(embedding)}
      limit ${scope.limit * 4}
    `);
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (const row of rows) {
      const key = `${row.source_type}:${row.source_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(toHit(row));
      if (hits.length === scope.limit) break;
    }
    return hits;
  }
}

import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { docTaskLinks, docVersions, docs } from '../../../infrastructure/db/schema.js';
import type { Doc } from '../domain/doc.js';
import type { DocListFilter, DocRepository } from '../domain/ports.js';

const summaryColumns = {
  id: docs.id,
  workspaceId: docs.workspaceId,
  projectId: docs.projectId,
  title: docs.title,
  createdBy: docs.createdBy,
  updatedBy: docs.updatedBy,
  updatedAt: docs.updatedAt,
};
const columns = {
  ...summaryColumns,
  body: docs.body,
  version: docs.version,
  createdAt: docs.createdAt,
};
const versionColumns = {
  id: docVersions.id,
  version: docVersions.version,
  title: docVersions.title,
  authorId: docVersions.authorId,
  createdAt: docVersions.createdAt,
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class DrizzleDocRepository implements DocRepository {
  constructor(private readonly db: DbExecutor) {}

  async findById(id: string): Promise<Doc | null> {
    const [row] = await this.db.select(columns).from(docs).where(eq(docs.id, id));
    return row ?? null;
  }

  async list(workspaceId: string, filter: DocListFilter) {
    const scope: SQL[] = [];
    if (filter.includeWorkspaceDocs) scope.push(isNull(docs.projectId));
    if (filter.projectIds.length) scope.push(inArray(docs.projectId, filter.projectIds));
    if (scope.length === 0) return [];
    const conds = [eq(docs.workspaceId, workspaceId), or(...scope)!];
    if (filter.search) conds.push(ilike(docs.title, `%${escapeLike(filter.search)}%`));
    return this.db
      .select(summaryColumns)
      .from(docs)
      .where(and(...conds))
      .orderBy(desc(docs.updatedAt))
      .limit(500);
  }

  async create(
    data: Pick<Doc, 'workspaceId' | 'projectId' | 'title' | 'body'> & { createdBy: string },
  ) {
    const [row] = await this.db
      .insert(docs)
      .values({ ...data, updatedBy: data.createdBy })
      .returning(columns);
    return row!;
  }

  async updateIfVersion(
    id: string,
    expectedVersion: number,
    patch: { title?: string; body?: string; updatedBy: string },
  ) {
    const [row] = await this.db
      .update(docs)
      .set({ ...patch, version: sql`${docs.version} + 1`, updatedAt: new Date() })
      .where(and(eq(docs.id, id), eq(docs.version, expectedVersion)))
      .returning(columns);
    return row ?? null;
  }

  async delete(id: string) {
    await this.db.delete(docs).where(eq(docs.id, id));
  }

  async latestSnapshot(docId: string) {
    const [row] = await this.db
      .select()
      .from(docVersions)
      .where(eq(docVersions.docId, docId))
      .orderBy(desc(docVersions.createdAt), desc(docVersions.version))
      .limit(1);
    return row ?? null;
  }

  async addSnapshot(data: {
    docId: string;
    version: number;
    title: string;
    body: string;
    authorId: string | null;
  }) {
    await this.db.insert(docVersions).values(data);
  }

  async replaceSnapshot(id: string, data: { version: number; title: string; body: string }) {
    await this.db.update(docVersions).set(data).where(eq(docVersions.id, id));
  }

  listSnapshots(docId: string) {
    return this.db
      .select(versionColumns)
      .from(docVersions)
      .where(eq(docVersions.docId, docId))
      .orderBy(desc(docVersions.createdAt), desc(docVersions.version));
  }

  async findSnapshot(docId: string, versionId: string) {
    const [row] = await this.db
      .select()
      .from(docVersions)
      .where(and(eq(docVersions.docId, docId), eq(docVersions.id, versionId)));
    return row ?? null;
  }

  async linkedTaskIds(docId: string) {
    const rows = await this.db
      .select({ taskId: docTaskLinks.taskId })
      .from(docTaskLinks)
      .where(eq(docTaskLinks.docId, docId));
    return rows.map((r) => r.taskId);
  }

  async linkTask(docId: string, taskId: string) {
    await this.db.insert(docTaskLinks).values({ docId, taskId }).onConflictDoNothing();
  }

  async unlinkTask(docId: string, taskId: string) {
    const rows = await this.db
      .delete(docTaskLinks)
      .where(and(eq(docTaskLinks.docId, docId), eq(docTaskLinks.taskId, taskId)))
      .returning({ taskId: docTaskLinks.taskId });
    return rows.length > 0;
  }
}

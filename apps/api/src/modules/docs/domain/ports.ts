import type { Doc, DocSummary, DocVersion } from './doc.js';

export interface DocListFilter {
  /** Include workspace-wide docs (not guests). */
  includeWorkspaceDocs: boolean;
  /** Project docs from these projects only (the ones the user can see). */
  projectIds: string[];
  search?: string;
}

export interface DocRepository {
  findById(id: string): Promise<Doc | null>;
  list(workspaceId: string, filter: DocListFilter): Promise<DocSummary[]>;
  create(
    data: Pick<Doc, 'workspaceId' | 'projectId' | 'title' | 'body'> & { createdBy: string },
  ): Promise<Doc>;
  /** Applies the patch only at `expectedVersion`; returns null on a version mismatch. */
  updateIfVersion(
    id: string,
    expectedVersion: number,
    patch: { title?: string; body?: string; updatedBy: string },
  ): Promise<Doc | null>;
  delete(id: string): Promise<void>;

  latestSnapshot(docId: string): Promise<DocVersion | null>;
  addSnapshot(data: Omit<DocVersion, 'id' | 'createdAt'>): Promise<void>;
  replaceSnapshot(id: string, data: Pick<DocVersion, 'version' | 'title' | 'body'>): Promise<void>;
  listSnapshots(docId: string): Promise<Omit<DocVersion, 'body' | 'docId'>[]>;
  findSnapshot(docId: string, versionId: string): Promise<DocVersion | null>;

  linkedTaskIds(docId: string): Promise<string[]>;
  linkTask(docId: string, taskId: string): Promise<void>;
  unlinkTask(docId: string, taskId: string): Promise<boolean>;
}

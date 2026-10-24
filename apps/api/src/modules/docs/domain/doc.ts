export interface Doc {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  body: string;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DocSummary = Omit<Doc, 'body' | 'version' | 'createdAt'>;

export interface DocVersion {
  id: string;
  docId: string;
  version: number;
  title: string;
  body: string;
  authorId: string | null;
  createdAt: Date;
}

/** Edits by the same person within this window are one editing session in the history. */
export const SNAPSHOT_SESSION_MS = 10 * 60 * 1000;

/**
 * Whether an edit starts a new history entry, or folds into the latest one (so autosaving
 * every few seconds doesn't create hundreds of versions).
 */
export function startsNewSnapshot(
  latest: Pick<DocVersion, 'authorId' | 'createdAt'> | null,
  authorId: string,
  now: Date,
): boolean {
  if (!latest) return true;
  return (
    latest.authorId !== authorId || now.getTime() - latest.createdAt.getTime() > SNAPSHOT_SESSION_MS
  );
}

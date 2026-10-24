import type { IndexableSource, SearchSourceType } from './search.js';

export interface SearchScope {
  workspaceId: string;
  userId: string;
  /** Guests don't see workspace-level (project-less) content unless explicitly allowed. */
  isGuest: boolean;
  visibleProjectIds: string[];
  types?: SearchSourceType[];
  limit: number;
}

export interface SearchHit {
  sourceType: SearchSourceType;
  sourceId: string;
  projectId: string | null;
  taskId: string | null;
  title: string;
  snippet: string;
}

export interface SearchIndexRepository {
  /** The content hash currently indexed for a source, to skip unchanged re-indexing. */
  currentHash(sourceType: SearchSourceType, sourceId: string): Promise<string | null>;
  /** Replaces every chunk of a source atomically. */
  replace(
    source: Omit<IndexableSource, 'title' | 'content'> & { hash: string },
    chunks: { title: string; content: string; embedding: number[] | null }[],
  ): Promise<void>;
  deleteSource(sourceType: SearchSourceType, sourceId: string): Promise<void>;
  /** Removes a task's comments too. */
  deleteTask(taskId: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  /** Best chunk per source, ranked by full-text relevance. Access rules apply in the query. */
  keyword(scope: SearchScope, query: { prefix: string; text: string }): Promise<SearchHit[]>;
  /** Best chunk per source, ranked by embedding similarity. Access rules apply in the query. */
  semantic(scope: SearchScope, embedding: number[], minSimilarity: number): Promise<SearchHit[]>;
}

export interface EmbeddingProvider {
  /** False when no provider is configured: search falls back to keywords only. */
  readonly enabled: boolean;
  /**
   * Cosine similarity below which a result is unrelated. Nearest-neighbour search always
   * returns something, so without a floor it would pad results with noise.
   */
  readonly minSimilarity: number;
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>;
}

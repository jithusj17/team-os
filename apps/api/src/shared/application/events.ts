import type { WorkspaceEvent, WorkspaceEventType } from '@team-os/shared';

export interface NewEvent {
  workspaceId: string;
  type: WorkspaceEventType;
  projectId?: string | null;
  taskId?: string | null;
  actorId: string | null;
  payload: unknown;
}

/**
 * The transactional outbox and sync log. `append` must run inside the same transaction as
 * the change it describes, so events exist if and only if the change committed.
 */
export interface EventRepository {
  append(event: NewEvent): Promise<void>;
  listSince(workspaceId: string, afterSeq: number, limit: number): Promise<WorkspaceEvent[]>;
  latestSeq(workspaceId: string): Promise<number>;
  /** The oldest seq still retained, or null if no events are stored. */
  oldestSeq(workspaceId: string): Promise<number | null>;
}

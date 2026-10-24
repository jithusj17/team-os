import type { WorkspaceEvent } from '@team-os/shared';

/** Tracks which users are viewing a room, across all API instances. */
export interface PresenceStore {
  enter(room: string, connectionId: string, userId: string): Promise<void>;
  leave(room: string, connectionId: string): Promise<void>;
  /** Distinct users with a live (non-expired) entry in the room. */
  userIds(room: string): Promise<string[]>;
}

/** Delivers committed events to connected clients. */
export interface EventPublisher {
  publish(event: WorkspaceEvent): Promise<void>;
}

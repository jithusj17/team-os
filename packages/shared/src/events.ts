import { z } from 'zod';

/**
 * Real-time events. Each is published to the project room (when `projectId` is set) or the
 * workspace room, and can be re-read later from GET /workspaces/:id/events?after=<seq>.
 */
export const workspaceEventTypes = [
  'task.created',
  'task.updated',
  'task.deleted',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'dependency.added',
  'dependency.removed',
  'project.created',
  'project.updated',
  'project.deleted',
  'project.statuses_changed',
  'project.members_changed',
  'label.changed',
  'workspace.updated',
  'workspace.members_changed',
] as const;
export const workspaceEventType = z.enum(workspaceEventTypes);
export type WorkspaceEventType = z.infer<typeof workspaceEventType>;

export const workspaceEvent = z.object({
  workspaceId: z.uuid(),
  /** Increases by exactly one per event within a workspace. */
  seq: z.number().int(),
  type: workspaceEventType,
  projectId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  actorId: z.uuid().nullable(),
  /** The changed entity (e.g. the task after the change), or its id for deletions. */
  payload: z.unknown(),
  createdAt: z.coerce.date(),
});
export type WorkspaceEvent = z.infer<typeof workspaceEvent>;

export const eventsQuery = z.object({
  after: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const eventsResponse = z.object({
  events: z.array(workspaceEvent),
  /** The workspace's latest seq; use it as `after` next time. */
  latestSeq: z.number().int(),
  hasMore: z.boolean(),
  /** True when `after` is older than retained history: refetch everything instead. */
  resyncRequired: z.boolean(),
});
export type EventsResponse = z.infer<typeof eventsResponse>;

// ---- Socket.IO protocol ----

export const SOCKET_PATH = '/socket.io';

export const subscribeMessage = z.union([
  z.object({ workspaceId: z.uuid() }),
  z.object({ projectId: z.uuid() }),
]);
export const presenceMessage = z.union([
  z.object({ projectId: z.uuid() }),
  z.object({ taskId: z.uuid() }),
]);

export type SocketAck =
  | { ok: true; room: string; latestSeq?: number }
  | { ok: false; error: { code: string; message: string } };

export interface PresenceUpdate {
  room: string;
  userIds: string[];
}

export interface ServerToClientEvents {
  event: (event: WorkspaceEvent) => void;
  presence: (update: PresenceUpdate) => void;
}

export interface ClientToServerEvents {
  subscribe: (msg: z.input<typeof subscribeMessage>, ack: (res: SocketAck) => void) => void;
  unsubscribe: (msg: z.input<typeof subscribeMessage>, ack?: (res: SocketAck) => void) => void;
  /** Send on open and every ~20s while viewing; presence expires after 60s without it. */
  'presence:enter': (msg: z.input<typeof presenceMessage>, ack?: (res: SocketAck) => void) => void;
  'presence:leave': (msg: z.input<typeof presenceMessage>) => void;
}

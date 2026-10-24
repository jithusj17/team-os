import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';
import type { ServerToClientEvents, WorkspaceEvent } from '@team-os/shared';
import type { EventPublisher } from '../application/ports.js';
import {
  accessRevokedUserId,
  projectAccessChanged,
  projectRoom,
  roomForEvent,
  userRoom,
} from '../domain/rooms.js';

/**
 * Publishes through Redis to every API instance's Socket.IO server (via the Redis adapter),
 * so it works from the worker process without holding any sockets itself.
 */
export class SocketIoEventPublisher implements EventPublisher {
  private readonly emitter: Emitter<ServerToClientEvents>;

  constructor(redis: Redis) {
    this.emitter = new Emitter<ServerToClientEvents>(redis);
  }

  async publish(event: WorkspaceEvent) {
    this.emitter.to(roomForEvent(event)).emit('event', event);

    // Access may have shrunk: drop the affected connections. Clients reconnect, and the
    // server re-checks permissions on every room they try to join again.
    const revokedUser = accessRevokedUserId(event.payload);
    if (revokedUser) this.emitter.in(userRoom(revokedUser)).disconnectSockets();
    if (event.projectId && projectAccessChanged(event)) {
      this.emitter.in(projectRoom(event.projectId)).disconnectSockets();
    }
    if (event.projectId && event.type === 'project.deleted') {
      this.emitter.in(projectRoom(event.projectId)).socketsLeave(projectRoom(event.projectId));
    }
  }
}

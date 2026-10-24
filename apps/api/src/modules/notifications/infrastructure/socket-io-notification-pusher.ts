import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';
import type { ServerToClientEvents } from '@team-os/shared';
import { userRoom } from '../../realtime/domain/rooms.js';
import type { NotificationPusher, StoredNotification } from '../domain/ports.js';

/** Pushes to every open connection of the user, on any API instance (via Redis). */
export class SocketIoNotificationPusher implements NotificationPusher {
  private readonly emitter: Emitter<ServerToClientEvents>;

  constructor(redis: Redis) {
    this.emitter = new Emitter<ServerToClientEvents>(redis);
  }

  async push({ userId, ...notification }: StoredNotification) {
    this.emitter.to(userRoom(userId)).emit('notification', notification);
  }
}

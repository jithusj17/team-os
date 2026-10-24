import { createAdapter } from '@socket.io/redis-adapter';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import {
  SOCKET_PATH,
  presenceMessage,
  subscribeMessage,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketAck,
} from '@team-os/shared';
import {
  projectRoom,
  taskRoom,
  userRoom,
  workspaceRoom,
} from '../modules/realtime/domain/rooms.js';
import { DomainError } from '../shared/domain/errors.js';
import { SESSION_COOKIE } from './auth.plugin.js';

interface SocketData {
  userId: string;
  sessionRoom: string;
  /** Presence rooms this connection is in, so they can be cleaned up on disconnect. */
  presenceRooms: Set<string>;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

declare module 'fastify' {
  interface FastifyInstance {
    realtime: { disconnectSession(sessionToken: string): void };
  }
}

function failure(err: unknown): SocketAck {
  if (err instanceof DomainError)
    return { ok: false, error: { code: err.code, message: err.message } };
  if (err && typeof err === 'object' && 'issues' in err) {
    return { ok: false, error: { code: 'validation_error', message: 'Invalid message' } };
  }
  return { ok: false, error: { code: 'internal_error', message: 'Something went wrong' } };
}

/**
 * Socket.IO on the API's HTTP server. Connections authenticate with the session cookie and may
 * only join rooms they are authorized for. The Redis adapter fans messages out across
 * instances; events themselves are published by the outbox relay in the worker.
 */
export async function attachRealtime(app: FastifyInstance) {
  const { config, container } = app;
  const { realtime, sessions, tokens } = container;
  // A room per session lets logout close just that browser's sockets, not every device's.
  const sessionRoom = (token: string) => `session:${tokens.hash(token)}`;

  const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(
    app.server,
    {
      path: SOCKET_PATH,
      serveClient: false,
      cors: { origin: config.WEB_ORIGIN, credentials: true },
      // Browsers attach cookies to cross-site WebSocket handshakes too, so in production we
      // only accept handshakes from our own web app (prevents cross-site WebSocket hijacking).
      allowRequest: (req, callback) => {
        const origin = req.headers.origin;
        const allowed = config.NODE_ENV !== 'production' || origin === config.WEB_ORIGIN;
        callback(allowed ? null : 'origin not allowed', allowed);
      },
    },
  );

  const pub = app.redis.duplicate({ lazyConnect: true, enableOfflineQueue: true });
  const sub = app.redis.duplicate({ lazyConnect: true, enableOfflineQueue: true });
  for (const client of [pub, sub]) {
    client.on('error', (err) => app.log.warn({ err }, 'Realtime Redis error'));
  }
  try {
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
  } catch (err) {
    // Without Redis, events from the worker can't reach this instance. Keep serving HTTP;
    // the health check reports Redis as down, so the orchestrator will restart us.
    app.log.error({ err }, 'Realtime Redis unavailable; using the in-process adapter');
    pub.disconnect();
    sub.disconnect();
  }

  io.use(async (socket, next) => {
    try {
      const token = app.parseCookie(socket.request.headers.cookie ?? '')[SESSION_COOKIE];
      const session = token ? await sessions.get(token) : null;
      if (!token || !session) return next(new Error('unauthorized'));
      socket.data.userId = session.userId;
      socket.data.sessionRoom = sessionRoom(token);
      socket.data.presenceRooms = new Set();
      next();
    } catch (err) {
      app.log.error({ err }, 'Socket authentication failed');
      next(new Error('unavailable'));
    }
  });

  const broadcastPresence = (update: { room: string; userIds: string[] }) =>
    io.to(update.room).emit('presence', update);

  io.on('connection', (socket: AppSocket) => {
    const { userId } = socket.data;
    void socket.join([userRoom(userId), socket.data.sessionRoom]);

    socket.on('subscribe', async (msg, ack) => {
      try {
        const { room, latestSeq } = await realtime.access.authorize(
          userId,
          subscribeMessage.parse(msg),
        );
        await socket.join(room);
        ack({ ok: true, room, latestSeq });
      } catch (err) {
        ack(failure(err));
      }
    });

    socket.on('unsubscribe', async (msg, ack) => {
      try {
        // Leaving needs no permission check, but the room name must be derived the same way.
        const target = subscribeMessage.parse(msg);
        const room =
          'workspaceId' in target
            ? workspaceRoom(target.workspaceId)
            : projectRoom(target.projectId);
        await socket.leave(room);
        ack?.({ ok: true, room });
      } catch (err) {
        ack?.(failure(err));
      }
    });

    socket.on('presence:enter', async (msg, ack) => {
      try {
        const update = await realtime.presence.enter(userId, socket.id, presenceMessage.parse(msg));
        if (!socket.data.presenceRooms.has(update.room)) {
          socket.data.presenceRooms.add(update.room);
          await socket.join(update.room);
        }
        broadcastPresence(update);
        ack?.({ ok: true, room: update.room });
      } catch (err) {
        ack?.(failure(err));
      }
    });

    socket.on('presence:leave', async (msg) => {
      const parsed = presenceMessage.safeParse(msg);
      if (!parsed.success) return;
      const room =
        'taskId' in parsed.data ? taskRoom(parsed.data.taskId) : projectRoom(parsed.data.projectId);
      if (!socket.data.presenceRooms.delete(room)) return;
      if ('taskId' in parsed.data) await socket.leave(room);
      broadcastPresence(await realtime.presence.leave(room, socket.id));
    });

    socket.on('disconnecting', () => {
      for (const room of socket.data.presenceRooms) {
        void realtime.presence
          .leave(room, socket.id)
          .then(broadcastPresence)
          .catch((err: unknown) => app.log.warn({ err }, 'Presence cleanup failed'));
      }
    });
  });

  app.decorate('realtime', {
    disconnectSession: (token: string) => io.in(sessionRoom(token)).disconnectSockets(),
  });

  // Open WebSockets would keep the HTTP server from closing, so drop them first.
  app.addHook('preClose', async () => {
    io.local.disconnectSockets(true);
    io.engine.close();
  });
  app.addHook('onClose', async () => {
    await Promise.allSettled([pub.quit(), sub.quit()]);
  });

  return io;
}

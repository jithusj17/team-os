import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import {
  eventsResponse,
  type ClientToServerEvents,
  type Notification,
  type ProjectStatus,
  type ServerToClientEvents,
  type SocketAck,
  type Task,
  type WorkspaceEvent,
} from '@team-os/shared';
import { addNotificationToCache } from '../features/notifications/hooks';
import { removeTaskFromCache, upsertTaskInCache } from '../features/tasks/hooks';
import { api } from './api';
import { keys } from './keys';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface RealtimeContextValue {
  socket: AppSocket | null;
  connected: boolean;
  /** Joins a project's room while the returned cleanup hasn't been called. */
  subscribeProject(projectId: string): () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/** Applies one server event to every cache that holds the affected data. */
function applyEvent(queryClient: QueryClient, e: WorkspaceEvent) {
  const invalidate = (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: key });
  switch (e.type) {
    case 'task.created':
    case 'task.updated': {
      const { changes: _changes, ...t } = e.payload as Task & { changes?: unknown };
      upsertTaskInCache(queryClient, t);
      void invalidate(keys.activity(t.id));
      break;
    }
    case 'task.deleted':
      if (e.projectId && e.taskId) removeTaskFromCache(queryClient, e.projectId, e.taskId);
      break;
    case 'comment.created':
    case 'comment.updated':
    case 'comment.deleted':
      if (e.taskId) {
        void invalidate(keys.comments(e.taskId));
        void invalidate(keys.activity(e.taskId));
      }
      break;
    case 'dependency.added':
    case 'dependency.removed': {
      const { blockerId, blockedId } = e.payload as { blockerId: string; blockedId: string };
      void invalidate(keys.dependencies(blockerId));
      void invalidate(keys.dependencies(blockedId));
      break;
    }
    case 'project.created':
    case 'project.updated':
    case 'project.deleted':
      void invalidate(keys.projects(e.workspaceId));
      if (e.projectId) void invalidate(keys.project(e.projectId));
      break;
    case 'project.statuses_changed': {
      const { statuses, tasksMoved } = e.payload as {
        statuses: ProjectStatus[];
        tasksMoved?: boolean;
      };
      if (!e.projectId) break;
      queryClient.setQueryData(keys.project(e.projectId), (old: object | undefined) =>
        old ? { ...old, statuses } : old,
      );
      if (tasksMoved) void invalidate(keys.tasks(e.projectId));
      break;
    }
    case 'project.members_changed':
      if (e.projectId) void invalidate(keys.projectMembers(e.projectId));
      break;
    case 'label.changed':
      void invalidate(keys.labels(e.workspaceId));
      break;
    case 'workspace.updated':
      void invalidate(keys.workspace(e.workspaceId));
      void invalidate(keys.workspaces);
      break;
    case 'workspace.members_changed':
      void invalidate(keys.members(e.workspaceId));
      break;
  }
}

/**
 * One socket per open workspace. Events update caches in place; after a reconnect the client
 * replays what it missed from /events, or refetches everything if history was pruned.
 */
export function RealtimeProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const projectRooms = useRef(new Map<string, number>());

  useEffect(() => {
    const s: AppSocket = io({
      path: '/api/socket.io',
      transports: ['websocket'],
      withCredentials: true,
    });
    let lastSeq: number | null = null;

    const handle = (e: WorkspaceEvent) => {
      if (e.workspaceId !== workspaceId) return;
      if (lastSeq !== null && e.seq <= lastSeq) return; // duplicate or already replayed
      lastSeq = e.seq;
      applyEvent(queryClient, e);
    };

    const catchUp = async (after: number) => {
      let cursor = after;
      for (;;) {
        const page = await api(`/workspaces/${workspaceId}/events?after=${cursor}`, eventsResponse);
        if (page.resyncRequired) {
          await queryClient.invalidateQueries();
          lastSeq = page.latestSeq;
          return;
        }
        page.events.forEach(handle);
        lastSeq = Math.max(lastSeq ?? 0, page.latestSeq);
        if (!page.hasMore) return;
        cursor = page.latestSeq;
      }
    };

    s.on('connect', () => {
      setConnected(true);
      s.emit('subscribe', { workspaceId }, (ack: SocketAck) => {
        if (!ack.ok) return;
        if (lastSeq === null) lastSeq = ack.latestSeq ?? 0;
        else void catchUp(lastSeq).catch(() => queryClient.invalidateQueries());
      });
      for (const projectId of projectRooms.current.keys())
        s.emit('subscribe', { projectId }, () => {});
    });
    s.on('disconnect', (reason) => {
      setConnected(false);
      // The server disconnects us when our access changes; reconnect to re-authorize.
      if (reason === 'io server disconnect') setTimeout(() => s.connect(), 300);
    });
    s.on('event', handle);
    s.on('notification', (n: Notification) => {
      addNotificationToCache(queryClient, n);
      toast(n.data.taskKey ? `${n.data.taskKey} · ${n.data.taskTitle ?? ''}` : 'New notification', {
        description: notificationSummary(n),
      });
    });
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [workspaceId, queryClient]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      socket,
      connected,
      subscribeProject(projectId) {
        const rooms = projectRooms.current;
        rooms.set(projectId, (rooms.get(projectId) ?? 0) + 1);
        if (rooms.get(projectId) === 1 && socket?.connected)
          socket.emit('subscribe', { projectId }, () => {});
        return () => {
          const n = (rooms.get(projectId) ?? 1) - 1;
          if (n > 0) rooms.set(projectId, n);
          else {
            rooms.delete(projectId);
            socket?.emit('unsubscribe', { projectId });
          }
        };
      },
    }),
    [socket, connected],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime used outside RealtimeProvider');
  return ctx;
}

/** Receives live updates for a project while the calling component is mounted. */
export function useProjectSubscription(projectId: string) {
  const { subscribeProject } = useRealtime();
  useEffect(() => subscribeProject(projectId), [projectId, subscribeProject]);
}

/** Announces that the user is viewing `taskId` and returns everyone else viewing it. */
export function usePresence(taskId: string | null) {
  const { socket, connected } = useRealtime();
  const [userIds, setUserIds] = useState<string[]>([]);

  useEffect(() => {
    if (!socket || !connected || !taskId) return;
    const room = `task:${taskId}`;
    const enter = () => socket.emit('presence:enter', { taskId });
    const onPresence = (p: { room: string; userIds: string[] }) => {
      if (p.room === room) setUserIds(p.userIds);
    };
    socket.on('presence', onPresence);
    enter();
    const heartbeat = setInterval(enter, 20_000);
    return () => {
      clearInterval(heartbeat);
      socket.off('presence', onPresence);
      socket.emit('presence:leave', { taskId });
      setUserIds([]);
    };
  }, [socket, connected, taskId]);

  return userIds;
}

function notificationSummary(n: Notification) {
  switch (n.type) {
    case 'assigned':
      return 'You were assigned';
    case 'mentioned':
      return n.data.excerpt ?? 'You were mentioned';
    case 'commented':
      return n.data.excerpt ?? 'New comment';
    case 'status_changed':
      return `Moved to ${n.data.statusName ?? 'a new status'}`;
    case 'blocker_resolved':
      return `${n.data.blockerKey ?? 'A blocker'} is done`;
    case 'due_soon':
      return 'Due soon';
  }
}

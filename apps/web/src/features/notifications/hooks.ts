import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  notificationList,
  notificationPreferences,
  type Notification,
  type NotificationPreferences,
} from '@team-os/shared';
import { api } from '../../lib/api';
import { keys } from '../../lib/keys';

type Inbox = { items: Notification[]; nextCursor: string | null; unreadCount: number };

export function useInbox() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => api('/me/notifications?limit=50', notificationList),
  });
}

/** Called for notifications pushed over the socket: prepend and bump the unread count. */
export function addNotificationToCache(
  queryClient: ReturnType<typeof useQueryClient>,
  n: Notification,
) {
  queryClient.setQueryData<Inbox>(keys.notifications, (old) =>
    old && !old.items.some((x) => x.id === n.id)
      ? { ...old, items: [n, ...old.items], unreadCount: old.unreadCount + 1 }
      : old,
  );
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (which: string[] | 'all') =>
      api('/me/notifications/read', null, {
        method: 'POST',
        body: which === 'all' ? { all: true } : { ids: which },
      }),
    onMutate: (which) => {
      const now = new Date();
      queryClient.setQueryData<Inbox>(keys.notifications, (old) => {
        if (!old) return old;
        const items = old.items.map((n) =>
          !n.readAt && (which === 'all' || which.includes(n.id)) ? { ...n, readAt: now } : n,
        );
        return { ...old, items, unreadCount: items.filter((n) => !n.readAt).length };
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.notifications }),
  });
}

export function usePreferences() {
  return useQuery({
    queryKey: keys.notificationPrefs,
    queryFn: () => api('/me/notification-preferences', notificationPreferences),
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prefs: NotificationPreferences) =>
      api('/me/notification-preferences', notificationPreferences, { method: 'PUT', body: prefs }),
    onSuccess: (prefs) => queryClient.setQueryData(keys.notificationPrefs, prefs),
  });
}

import type { NotificationPreferences } from '@team-os/shared';
import type { Notification, NotificationDraft } from './notification.js';

/** A stored notification and who it belongs to. */
export type StoredNotification = Notification & { userId: string };

export interface DigestBatch {
  userId: string;
  email: string;
  name: string;
  notifications: (StoredNotification & { actorName: string | null })[];
}

export interface NotificationRepository {
  /** Inserts drafts, skipping any whose (userId, dedupeKey) exists. Returns those inserted. */
  insertMany(drafts: NotificationDraft[]): Promise<StoredNotification[]>;
  list(
    userId: string,
    opts: { unreadOnly: boolean; cursor?: string; limit: number },
  ): Promise<{ items: Notification[]; nextCursor: string | null }>;
  unreadCount(userId: string): Promise<number>;
  /** Marks the user's notifications read (`'all'` or specific ids). Returns how many changed. */
  markRead(userId: string, ids: string[] | 'all', now: Date): Promise<number>;
  /** Unread, not-yet-emailed notifications since `since`, grouped per user opted into digests. */
  digestBatches(since: Date): Promise<DigestBatch[]>;
  markEmailed(ids: string[], now: Date): Promise<void>;
}

export interface PreferenceRepository {
  get(userId: string): Promise<NotificationPreferences>;
  getMany(userIds: string[]): Promise<Map<string, NotificationPreferences>>;
  set(userId: string, prefs: NotificationPreferences): Promise<NotificationPreferences>;
}

/** Delivers a new notification to the user's open connections. */
export interface NotificationPusher {
  push(notification: StoredNotification): Promise<void>;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = { mutedTypes: [], emailDigest: true };

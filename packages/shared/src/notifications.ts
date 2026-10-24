import { z } from 'zod';

export const notificationTypes = [
  'assigned',
  'mentioned',
  'commented',
  'status_changed',
  'blocker_resolved',
  'due_soon',
] as const;
export const notificationType = z.enum(notificationTypes);
export type NotificationType = z.infer<typeof notificationType>;

export const notification = z.object({
  id: z.uuid(),
  type: notificationType,
  workspaceId: z.uuid(),
  projectId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  actorId: z.uuid().nullable(),
  /** Display data captured when the notification was created (task key and title, etc.). */
  data: z.object({
    taskKey: z.string().optional(),
    taskTitle: z.string().optional(),
    commentId: z.uuid().optional(),
    excerpt: z.string().optional(),
    statusName: z.string().optional(),
    dueDate: z.string().optional(),
    blockerKey: z.string().optional(),
  }),
  readAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type Notification = z.infer<typeof notification>;

export const listNotificationsQuery = z.object({
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const notificationList = z.object({
  items: z.array(notification),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int(),
});

export const markReadBody = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

export const notificationPreferences = z.object({
  mutedTypes: z.array(notificationType),
  emailDigest: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferences>;

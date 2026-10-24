import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listNotificationsQuery,
  markReadBody,
  notificationList,
  notificationPreferences,
} from '@team-os/shared';
import { requireAuth } from '../../../http/auth.plugin.js';

/** The signed-in user's own inbox and preferences; nothing here is workspace-scoped. */
export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  const uc = app.container.notifications;
  const me = (req: Parameters<typeof requireAuth>[0]) => requireAuth(req).userId;

  app.addHook('onRequest', async (req) => {
    requireAuth(req);
  });

  app.get(
    '/me/notifications',
    { schema: { querystring: listNotificationsQuery, response: { 200: notificationList } } },
    (req) =>
      uc.list.execute(me(req), {
        unreadOnly: req.query.unread ?? false,
        cursor: req.query.cursor,
        limit: req.query.limit,
      }),
  );

  app.post(
    '/me/notifications/read',
    {
      schema: {
        body: markReadBody,
        response: { 200: z.object({ updated: z.number().int(), unreadCount: z.number().int() }) },
      },
    },
    (req) => uc.markRead.execute(me(req), 'all' in req.body ? 'all' : req.body.ids),
  );

  app.get(
    '/me/notification-preferences',
    { schema: { response: { 200: notificationPreferences } } },
    (req) => uc.getPreferences.execute(me(req)),
  );

  app.put(
    '/me/notification-preferences',
    { schema: { body: notificationPreferences, response: { 200: notificationPreferences } } },
    (req) => uc.updatePreferences.execute(me(req), req.body),
  );
};

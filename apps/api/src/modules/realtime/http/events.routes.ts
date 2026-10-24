import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eventsQuery, eventsResponse } from '@team-os/shared';
import { requireAuth } from '../../../http/auth.plugin.js';

export const eventRoutes: FastifyPluginAsyncZod = async (app) => {
  const { realtime } = app.container;

  app.get(
    '/workspaces/:workspaceId/events',
    {
      schema: {
        params: z.object({ workspaceId: z.uuid() }),
        querystring: eventsQuery,
        response: { 200: eventsResponse },
      },
    },
    (req) =>
      realtime.listEvents.execute(
        requireAuth(req).userId,
        req.params.workspaceId,
        req.query.after,
        req.query.limit,
      ),
  );
};

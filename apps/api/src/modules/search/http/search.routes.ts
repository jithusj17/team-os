import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { searchQuery, searchResponse } from '@team-os/shared';
import { requireAuth } from '../../../http/auth.plugin.js';

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/workspaces/:workspaceId/search',
    {
      schema: {
        params: z.object({ workspaceId: z.uuid() }),
        querystring: searchQuery,
        response: { 200: searchResponse },
      },
    },
    (req) =>
      app.container.search.search.execute(
        requireAuth(req).userId,
        req.params.workspaceId,
        req.query,
      ),
  );
};

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createDocBody,
  doc,
  docSummary,
  docVersion,
  docVersionDetail,
  linkTaskBody,
  listDocsQuery,
  updateDocBody,
} from '@team-os/shared';
import { requireAuth } from '../../../http/auth.plugin.js';

const docParams = z.object({ docId: z.uuid() });

export const docRoutes: FastifyPluginAsyncZod = async (app) => {
  const uc = app.container.docs;
  const actor = (req: Parameters<typeof requireAuth>[0]) => requireAuth(req).userId;
  app.addHook('onRequest', async (req) => {
    requireAuth(req);
  });

  app.get(
    '/workspaces/:workspaceId/docs',
    {
      schema: {
        params: z.object({ workspaceId: z.uuid() }),
        querystring: listDocsQuery,
        response: { 200: z.array(docSummary) },
      },
    },
    (req) => uc.list.execute(actor(req), req.params.workspaceId, req.query),
  );

  app.post(
    '/workspaces/:workspaceId/docs',
    {
      schema: {
        params: z.object({ workspaceId: z.uuid() }),
        body: createDocBody,
        response: { 201: doc },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await uc.create.execute(actor(req), req.params.workspaceId, req.body)),
  );

  app.get('/docs/:docId', { schema: { params: docParams, response: { 200: doc } } }, (req) =>
    uc.get.execute(actor(req), req.params.docId),
  );

  app.patch(
    '/docs/:docId',
    { schema: { params: docParams, body: updateDocBody, response: { 200: doc } } },
    (req) => uc.update.execute(actor(req), req.params.docId, req.body),
  );

  app.delete('/docs/:docId', { schema: { params: docParams } }, async (req, reply) => {
    await uc.delete.execute(actor(req), req.params.docId);
    return reply.code(204).send();
  });

  app.get(
    '/docs/:docId/versions',
    { schema: { params: docParams, response: { 200: z.array(docVersion) } } },
    (req) => uc.versions.execute(actor(req), req.params.docId),
  );

  app.get(
    '/docs/:docId/versions/:versionId',
    {
      schema: {
        params: docParams.extend({ versionId: z.uuid() }),
        response: { 200: docVersionDetail },
      },
    },
    (req) => uc.version.execute(actor(req), req.params.docId, req.params.versionId),
  );

  app.post(
    '/docs/:docId/tasks',
    { schema: { params: docParams, body: linkTaskBody, response: { 200: doc } } },
    (req) => uc.linkTask.execute(actor(req), req.params.docId, req.body.taskId, true),
  );

  app.delete(
    '/docs/:docId/tasks/:taskId',
    { schema: { params: docParams.extend({ taskId: z.uuid() }), response: { 200: doc } } },
    (req) => uc.linkTask.execute(actor(req), req.params.docId, req.params.taskId, false),
  );
};

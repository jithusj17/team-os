import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  activityEntry,
  comment,
  commentBody,
  createLabelBody,
  createTaskBody,
  label,
  listTasksQuery,
  task,
  taskList,
  updateLabelBody,
  updateTaskBody,
} from '@team-os/shared';
import { requireAuth } from '../../../http/auth.plugin.js';

const workspaceParams = z.object({ workspaceId: z.uuid() });
const projectParams = z.object({ projectId: z.uuid() });
const taskParams = z.object({ taskId: z.uuid() });
const commentParams = z.object({ commentId: z.uuid() });
const labelParams = workspaceParams.extend({ labelId: z.uuid() });

export const taskRoutes: FastifyPluginAsyncZod = async (app) => {
  const { tasks: uc, labels } = app.container;
  const actor = (req: Parameters<typeof requireAuth>[0]) => requireAuth(req).userId;

  app.addHook('onRequest', async (req) => {
    requireAuth(req);
  });

  // ---- Tasks ----

  app.get(
    '/projects/:projectId/tasks',
    { schema: { params: projectParams, querystring: listTasksQuery, response: { 200: taskList } } },
    (req) => uc.list.execute(actor(req), req.params.projectId, req.query),
  );

  app.post(
    '/projects/:projectId/tasks',
    { schema: { params: projectParams, body: createTaskBody, response: { 201: task } } },
    async (req, reply) =>
      reply.code(201).send(await uc.create.execute(actor(req), req.params.projectId, req.body)),
  );

  app.get('/tasks/:taskId', { schema: { params: taskParams, response: { 200: task } } }, (req) =>
    uc.get.execute(actor(req), req.params.taskId),
  );

  app.get(
    '/workspaces/:workspaceId/tasks/by-key/:key',
    {
      schema: {
        params: workspaceParams.extend({ key: z.string().max(25) }),
        response: { 200: task },
      },
    },
    (req) => uc.getByKey.execute(actor(req), req.params.workspaceId, req.params.key),
  );

  app.patch(
    '/tasks/:taskId',
    { schema: { params: taskParams, body: updateTaskBody, response: { 200: task } } },
    (req) => uc.update.execute(actor(req), req.params.taskId, req.body),
  );

  app.delete('/tasks/:taskId', { schema: { params: taskParams } }, async (req, reply) => {
    await uc.delete.execute(actor(req), req.params.taskId);
    return reply.code(204).send();
  });

  app.get(
    '/tasks/:taskId/activity',
    { schema: { params: taskParams, response: { 200: z.array(activityEntry) } } },
    (req) => uc.activity.execute(actor(req), req.params.taskId),
  );

  // ---- Comments ----

  app.get(
    '/tasks/:taskId/comments',
    { schema: { params: taskParams, response: { 200: z.array(comment) } } },
    (req) => uc.listComments.execute(actor(req), req.params.taskId),
  );

  app.post(
    '/tasks/:taskId/comments',
    { schema: { params: taskParams, body: commentBody, response: { 201: comment } } },
    async (req, reply) =>
      reply
        .code(201)
        .send(await uc.addComment.execute(actor(req), req.params.taskId, req.body.body)),
  );

  app.patch(
    '/comments/:commentId',
    { schema: { params: commentParams, body: commentBody, response: { 200: comment } } },
    (req) => uc.editComment.execute(actor(req), req.params.commentId, req.body.body),
  );

  app.delete('/comments/:commentId', { schema: { params: commentParams } }, async (req, reply) => {
    await uc.deleteComment.execute(actor(req), req.params.commentId);
    return reply.code(204).send();
  });

  // ---- Labels ----

  app.get(
    '/workspaces/:workspaceId/labels',
    { schema: { params: workspaceParams, response: { 200: z.array(label) } } },
    (req) => labels.list.execute(actor(req), req.params.workspaceId),
  );

  app.post(
    '/workspaces/:workspaceId/labels',
    { schema: { params: workspaceParams, body: createLabelBody, response: { 201: label } } },
    async (req, reply) =>
      reply
        .code(201)
        .send(await labels.create.execute(actor(req), req.params.workspaceId, req.body)),
  );

  app.patch(
    '/workspaces/:workspaceId/labels/:labelId',
    { schema: { params: labelParams, body: updateLabelBody, response: { 200: label } } },
    (req) =>
      labels.update.execute(actor(req), req.params.workspaceId, req.params.labelId, req.body),
  );

  app.delete(
    '/workspaces/:workspaceId/labels/:labelId',
    { schema: { params: labelParams } },
    async (req, reply) => {
      await labels.delete.execute(actor(req), req.params.workspaceId, req.params.labelId);
      return reply.code(204).send();
    },
  );
};

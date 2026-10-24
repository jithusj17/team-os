import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createProjectBody,
  createStatusBody,
  project,
  projectDetail,
  projectMember,
  projectStatus,
  reorderStatusesBody,
  setProjectMemberBody,
  updateProjectBody,
  updateStatusBody,
} from '@team-os/shared';
import { requireAuth } from '../../../http/auth.plugin.js';

const workspaceParams = z.object({ workspaceId: z.uuid() });
const projectParams = z.object({ projectId: z.uuid() });
const memberParams = projectParams.extend({ userId: z.uuid() });
const statusParams = projectParams.extend({ statusId: z.uuid() });

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  const uc = app.container.projects;
  const actor = (req: Parameters<typeof requireAuth>[0]) => requireAuth(req).userId;

  app.addHook('onRequest', async (req) => {
    requireAuth(req);
  });

  // ---- Projects ----

  app.get(
    '/workspaces/:workspaceId/projects',
    { schema: { params: workspaceParams, response: { 200: z.array(project) } } },
    (req) => uc.list.execute(actor(req), req.params.workspaceId),
  );

  app.post(
    '/workspaces/:workspaceId/projects',
    {
      schema: {
        params: workspaceParams,
        body: createProjectBody,
        response: { 201: projectDetail },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await uc.create.execute(actor(req), req.params.workspaceId, req.body)),
  );

  app.get(
    '/projects/:projectId',
    { schema: { params: projectParams, response: { 200: projectDetail } } },
    (req) => uc.get.execute(actor(req), req.params.projectId),
  );

  app.patch(
    '/projects/:projectId',
    {
      schema: { params: projectParams, body: updateProjectBody, response: { 200: projectDetail } },
    },
    (req) => uc.update.execute(actor(req), req.params.projectId, req.body),
  );

  app.delete('/projects/:projectId', { schema: { params: projectParams } }, async (req, reply) => {
    await uc.delete.execute(actor(req), req.params.projectId);
    return reply.code(204).send();
  });

  // ---- Project members ----

  app.get(
    '/projects/:projectId/members',
    { schema: { params: projectParams, response: { 200: z.array(projectMember) } } },
    (req) => uc.listMembers.execute(actor(req), req.params.projectId),
  );

  app.put(
    '/projects/:projectId/members/:userId',
    { schema: { params: memberParams, body: setProjectMemberBody } },
    async (req, reply) => {
      const { projectId, userId } = req.params;
      await uc.setMember.execute(actor(req), projectId, userId, req.body.role);
      return reply.code(204).send();
    },
  );

  app.delete(
    '/projects/:projectId/members/:userId',
    { schema: { params: memberParams } },
    async (req, reply) => {
      await uc.removeMember.execute(actor(req), req.params.projectId, req.params.userId);
      return reply.code(204).send();
    },
  );

  // ---- Statuses ----

  app.post(
    '/projects/:projectId/statuses',
    { schema: { params: projectParams, body: createStatusBody, response: { 201: projectStatus } } },
    async (req, reply) =>
      reply
        .code(201)
        .send(await uc.createStatus.execute(actor(req), req.params.projectId, req.body)),
  );

  app.patch(
    '/projects/:projectId/statuses/:statusId',
    { schema: { params: statusParams, body: updateStatusBody, response: { 200: projectStatus } } },
    (req) =>
      uc.updateStatus.execute(actor(req), req.params.projectId, req.params.statusId, req.body),
  );

  app.put(
    '/projects/:projectId/statuses/order',
    {
      schema: {
        params: projectParams,
        body: reorderStatusesBody,
        response: { 200: z.array(projectStatus) },
      },
    },
    (req) => uc.reorderStatuses.execute(actor(req), req.params.projectId, req.body.statusIds),
  );

  app.delete(
    '/projects/:projectId/statuses/:statusId',
    { schema: { params: statusParams, querystring: z.object({ moveTo: z.uuid().optional() }) } },
    async (req, reply) => {
      const { projectId, statusId } = req.params;
      await uc.deleteStatus.execute(actor(req), projectId, statusId, req.query.moveTo);
      return reply.code(204).send();
    },
  );
};

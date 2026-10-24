import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createInviteBody,
  createInviteResponse,
  createWorkspaceBody,
  invite,
  invitePreview,
  member,
  updateMemberBody,
  updateWorkspaceBody,
  workspace,
} from '@team-os/shared';
import { requireAuth } from '../../../http/auth.plugin.js';

const workspaceParams = z.object({ workspaceId: z.uuid() });
const memberParams = workspaceParams.extend({ userId: z.uuid() });
const inviteParams = workspaceParams.extend({ inviteId: z.uuid() });
const tokenParams = z.object({ token: z.string().min(20).max(100) });

/** HTTP adapter for the workspaces module: parse input, call a use case, shape the output. */
export const workspaceRoutes: FastifyPluginAsyncZod = async (app) => {
  const uc = app.container.workspaces;
  const actor = (req: Parameters<typeof requireAuth>[0]) => requireAuth(req).userId;

  // Every route in this plugin requires a signed-in user.
  app.addHook('onRequest', async (req) => {
    requireAuth(req);
  });

  // ---- Workspaces ----

  app.get('/workspaces', { schema: { response: { 200: z.array(workspace) } } }, (req) =>
    uc.list.execute(actor(req)),
  );

  app.post(
    '/workspaces',
    { schema: { body: createWorkspaceBody, response: { 201: workspace } } },
    async (req, reply) => reply.code(201).send(await uc.create.execute(actor(req), req.body)),
  );

  app.get(
    '/workspaces/:workspaceId',
    { schema: { params: workspaceParams, response: { 200: workspace } } },
    (req) => uc.get.execute(actor(req), req.params.workspaceId),
  );

  app.patch(
    '/workspaces/:workspaceId',
    {
      schema: { params: workspaceParams, body: updateWorkspaceBody, response: { 200: workspace } },
    },
    (req) => uc.update.execute(actor(req), req.params.workspaceId, req.body),
  );

  app.delete(
    '/workspaces/:workspaceId',
    { schema: { params: workspaceParams } },
    async (req, reply) => {
      await uc.delete.execute(actor(req), req.params.workspaceId);
      req.log.info({ workspaceId: req.params.workspaceId }, 'Workspace deleted');
      return reply.code(204).send();
    },
  );

  // ---- Members ----

  app.get(
    '/workspaces/:workspaceId/members',
    { schema: { params: workspaceParams, response: { 200: z.array(member) } } },
    (req) => uc.listMembers.execute(actor(req), req.params.workspaceId),
  );

  app.patch(
    '/workspaces/:workspaceId/members/:userId',
    { schema: { params: memberParams, body: updateMemberBody } },
    async (req, reply) => {
      const { workspaceId, userId } = req.params;
      await uc.changeMemberRole.execute(actor(req), workspaceId, userId, req.body.role);
      return reply.code(204).send();
    },
  );

  app.delete(
    '/workspaces/:workspaceId/members/:userId',
    { schema: { params: memberParams } },
    async (req, reply) => {
      await uc.removeMember.execute(actor(req), req.params.workspaceId, req.params.userId);
      return reply.code(204).send();
    },
  );

  // ---- Invites (workspace side) ----

  app.get(
    '/workspaces/:workspaceId/invites',
    { schema: { params: workspaceParams, response: { 200: z.array(invite) } } },
    (req) => uc.listInvites.execute(actor(req), req.params.workspaceId),
  );

  app.post(
    '/workspaces/:workspaceId/invites',
    {
      schema: {
        params: workspaceParams,
        body: createInviteBody,
        response: { 201: createInviteResponse },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await uc.createInvite.execute(actor(req), req.params.workspaceId, req.body)),
  );

  app.delete(
    '/workspaces/:workspaceId/invites/:inviteId',
    { schema: { params: inviteParams } },
    async (req, reply) => {
      await uc.revokeInvite.execute(actor(req), req.params.workspaceId, req.params.inviteId);
      return reply.code(204).send();
    },
  );

  // ---- Invites (invitee side) ----

  app.get(
    '/invites/:token',
    { schema: { params: tokenParams, response: { 200: invitePreview } } },
    (req) => uc.previewInvite.execute(req.params.token),
  );

  app.post(
    '/invites/:token/accept',
    { schema: { params: tokenParams, response: { 200: z.object({ workspaceId: z.uuid() }) } } },
    (req) => uc.acceptInvite.execute(actor(req), req.params.token),
  );
};

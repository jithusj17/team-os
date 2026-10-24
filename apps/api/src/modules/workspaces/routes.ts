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
import { authorizeWorkspace } from '../../lib/authorize.js';
import { unauthorized } from '../../lib/errors.js';
import { requireAuth } from '../auth/plugin.js';
import { getUser } from '../auth/service.js';
import * as service from './service.js';

const workspaceParams = z.object({ workspaceId: z.uuid() });
const memberParams = workspaceParams.extend({ userId: z.uuid() });
const inviteParams = workspaceParams.extend({ inviteId: z.uuid() });
const tokenParams = z.object({ token: z.string().min(20).max(100) });

export const workspaceRoutes: FastifyPluginAsyncZod = async (app) => {
  // Every route in this plugin requires a signed-in user.
  app.addHook('onRequest', async (req) => {
    requireAuth(req);
  });

  // ---- Workspaces ----

  app.get('/workspaces', { schema: { response: { 200: z.array(workspace) } } }, async (req) =>
    service.listWorkspaces(app.db, requireAuth(req).userId),
  );

  app.post(
    '/workspaces',
    { schema: { body: createWorkspaceBody, response: { 201: workspace } } },
    async (req, reply) => {
      const created = await service.createWorkspace(app.db, requireAuth(req).userId, req.body);
      return reply.code(201).send(created);
    },
  );

  app.get(
    '/workspaces/:workspaceId',
    { schema: { params: workspaceParams, response: { 200: workspace } } },
    async (req) => {
      const { workspaceId } = req.params;
      const { role } = await authorizeWorkspace(req, workspaceId, { action: 'workspace:read' });
      return service.getWorkspace(app.db, workspaceId, role);
    },
  );

  app.patch(
    '/workspaces/:workspaceId',
    {
      schema: { params: workspaceParams, body: updateWorkspaceBody, response: { 200: workspace } },
    },
    async (req) => {
      const { workspaceId } = req.params;
      const { role } = await authorizeWorkspace(req, workspaceId, { action: 'workspace:update' });
      return service.updateWorkspace(app.db, workspaceId, role, req.body);
    },
  );

  app.delete(
    '/workspaces/:workspaceId',
    { schema: { params: workspaceParams } },
    async (req, reply) => {
      const { workspaceId } = req.params;
      await authorizeWorkspace(req, workspaceId, { action: 'workspace:delete' });
      await service.deleteWorkspace(app.db, workspaceId);
      req.log.info({ workspaceId }, 'Workspace deleted');
      return reply.code(204).send();
    },
  );

  // ---- Members ----

  app.get(
    '/workspaces/:workspaceId/members',
    { schema: { params: workspaceParams, response: { 200: z.array(member) } } },
    async (req) => {
      const { workspaceId } = req.params;
      await authorizeWorkspace(req, workspaceId, { action: 'member:list' });
      return service.listMembers(app.db, workspaceId);
    },
  );

  app.patch(
    '/workspaces/:workspaceId/members/:userId',
    { schema: { params: memberParams, body: updateMemberBody } },
    async (req, reply) => {
      const { workspaceId, userId } = req.params;
      // Membership of the caller is checked first, so non-members can't probe member IDs.
      await authorizeWorkspace(req, workspaceId, { action: 'workspace:read' });
      const targetRole = await service.getMemberRole(app.db, workspaceId, userId);
      await authorizeWorkspace(req, workspaceId, {
        action: 'member:change-role',
        targetRole,
        newRole: req.body.role,
      });
      await service.changeMemberRole(app.db, workspaceId, userId, req.body.role);
      return reply.code(204).send();
    },
  );

  app.delete(
    '/workspaces/:workspaceId/members/:userId',
    { schema: { params: memberParams } },
    async (req, reply) => {
      const { workspaceId, userId } = req.params;
      const actor = await authorizeWorkspace(req, workspaceId, { action: 'workspace:read' });
      const targetRole = await service.getMemberRole(app.db, workspaceId, userId);
      await authorizeWorkspace(req, workspaceId, {
        action: 'member:remove',
        targetRole,
        isSelf: actor.userId === userId,
      });
      await service.removeMember(app.db, workspaceId, userId);
      return reply.code(204).send();
    },
  );

  // ---- Invites (workspace side) ----

  app.get(
    '/workspaces/:workspaceId/invites',
    { schema: { params: workspaceParams, response: { 200: z.array(invite) } } },
    async (req) => {
      const { workspaceId } = req.params;
      await authorizeWorkspace(req, workspaceId, { action: 'invite:list' });
      return service.listOpenInvites(app.db, workspaceId);
    },
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
    async (req, reply) => {
      const { workspaceId } = req.params;
      const { userId, role } = await authorizeWorkspace(req, workspaceId, {
        action: 'invite:create',
        role: req.body.role,
      });
      const { invite: created, token } = await service.createInvite(
        app.db,
        workspaceId,
        userId,
        req.body,
      );
      const acceptUrl = `${app.config.WEB_ORIGIN}/invites/${token}`;

      // Enqueued after the transaction commits, so the worker never emails a rolled-back invite.
      const [ws, inviter] = await Promise.all([
        service.getWorkspace(app.db, workspaceId, role),
        getUser(app.db, userId),
      ]);
      await app.queues.sendEmail({
        type: 'workspace-invite',
        to: created.email,
        workspaceName: ws.name,
        inviterName: inviter?.name ?? 'A teammate',
        role: created.role,
        acceptUrl,
        expiresAt: created.expiresAt.toISOString(),
      });
      return reply.code(201).send({ invite: created, acceptUrl });
    },
  );

  app.delete(
    '/workspaces/:workspaceId/invites/:inviteId',
    { schema: { params: inviteParams } },
    async (req, reply) => {
      const { workspaceId, inviteId } = req.params;
      await authorizeWorkspace(req, workspaceId, { action: 'invite:revoke' });
      await service.revokeInvite(app.db, workspaceId, inviteId);
      return reply.code(204).send();
    },
  );

  // ---- Invites (invitee side) ----

  app.get(
    '/invites/:token',
    { schema: { params: tokenParams, response: { 200: invitePreview } } },
    async (req) => service.previewInvite(app.db, req.params.token),
  );

  app.post(
    '/invites/:token/accept',
    {
      schema: { params: tokenParams, response: { 200: z.object({ workspaceId: z.uuid() }) } },
    },
    async (req) => {
      const current = await getUser(app.db, requireAuth(req).userId);
      if (!current) throw unauthorized();
      return service.acceptInvite(app.db, req.params.token, current);
    },
  );
};

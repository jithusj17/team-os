import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createMeetingBody,
  linkTaskBody,
  listMeetingsQuery,
  meeting,
  rsvpBody,
  updateMeetingBody,
} from '@team-os/shared';
import { requireAuth } from '../../../http/auth.plugin.js';

const meetingParams = z.object({ meetingId: z.uuid() });
const workspaceParams = z.object({ workspaceId: z.uuid() });

export const meetingRoutes: FastifyPluginAsyncZod = async (app) => {
  const uc = app.container.meetings;
  const actor = (req: Parameters<typeof requireAuth>[0]) => requireAuth(req).userId;
  app.addHook('onRequest', async (req) => {
    requireAuth(req);
  });

  app.get(
    '/workspaces/:workspaceId/meetings',
    {
      schema: {
        params: workspaceParams,
        querystring: listMeetingsQuery,
        response: { 200: z.array(meeting) },
      },
    },
    (req) => uc.list.execute(actor(req), req.params.workspaceId, req.query),
  );

  app.post(
    '/workspaces/:workspaceId/meetings',
    { schema: { params: workspaceParams, body: createMeetingBody, response: { 201: meeting } } },
    async (req, reply) =>
      reply.code(201).send(await uc.create.execute(actor(req), req.params.workspaceId, req.body)),
  );

  app.get(
    '/meetings/:meetingId',
    { schema: { params: meetingParams, response: { 200: meeting } } },
    (req) => uc.get.execute(actor(req), req.params.meetingId),
  );

  app.patch(
    '/meetings/:meetingId',
    { schema: { params: meetingParams, body: updateMeetingBody, response: { 200: meeting } } },
    (req) => uc.update.execute(actor(req), req.params.meetingId, req.body),
  );

  app.delete('/meetings/:meetingId', { schema: { params: meetingParams } }, async (req, reply) => {
    await uc.delete.execute(actor(req), req.params.meetingId);
    return reply.code(204).send();
  });

  app.put(
    '/meetings/:meetingId/rsvp',
    { schema: { params: meetingParams, body: rsvpBody, response: { 200: meeting } } },
    (req) => uc.respond.execute(actor(req), req.params.meetingId, req.body.response),
  );

  app.post(
    '/meetings/:meetingId/notes',
    { schema: { params: meetingParams, response: { 200: z.object({ docId: z.uuid() }) } } },
    (req) => uc.openNotes.execute(actor(req), req.params.meetingId),
  );

  app.post(
    '/meetings/:meetingId/tasks',
    { schema: { params: meetingParams, body: linkTaskBody, response: { 200: meeting } } },
    (req) => uc.linkTask.execute(actor(req), req.params.meetingId, req.body.taskId, true),
  );

  app.delete(
    '/meetings/:meetingId/tasks/:taskId',
    { schema: { params: meetingParams.extend({ taskId: z.uuid() }), response: { 200: meeting } } },
    (req) => uc.linkTask.execute(actor(req), req.params.meetingId, req.params.taskId, false),
  );
};

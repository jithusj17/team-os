import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  aiProposal,
  aiStatus,
  askBody,
  executeProposalBody,
  proposeActionsBody,
  summarizeBody,
} from '@team-os/shared';
import { requireAuth } from '../../../http/auth.plugin.js';
import { sendEventStream } from '../../../http/sse.js';

export const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  const { ai } = app.container;
  // AI calls are slow and cost money, so they get a tighter per-user limit.
  const aiRateLimit = {
    rateLimit: { max: app.config.AI_RATE_LIMIT_MAX, timeWindow: '1 minute' },
  };

  app.get('/ai/status', { schema: { response: { 200: aiStatus } } }, () => ai.status.execute());

  app.post(
    '/ai/summaries',
    { config: aiRateLimit, schema: { body: summarizeBody } },
    (req, reply) =>
      sendEventStream(req, reply, (signal) =>
        ai.summarize.execute(requireAuth(req).userId, req.body, signal),
      ),
  );

  app.post(
    '/workspaces/:workspaceId/ai/ask',
    {
      config: aiRateLimit,
      schema: { params: z.object({ workspaceId: z.uuid() }), body: askBody },
    },
    (req, reply) =>
      sendEventStream(req, reply, (signal) =>
        ai.ask.execute(requireAuth(req).userId, req.params.workspaceId, req.body.question, signal),
      ),
  );

  app.post(
    '/workspaces/:workspaceId/ai/proposals',
    {
      config: aiRateLimit,
      schema: {
        params: z.object({ workspaceId: z.uuid() }),
        body: proposeActionsBody,
        response: { 201: aiProposal },
      },
    },
    async (req, reply) => {
      const proposal = await ai.propose.execute(
        requireAuth(req).userId,
        req.params.workspaceId,
        req.body,
      );
      return reply.status(201).send(proposal);
    },
  );

  app.get(
    '/ai/proposals/:proposalId',
    {
      schema: { params: z.object({ proposalId: z.uuid() }), response: { 200: aiProposal } },
    },
    (req) => ai.getProposal.execute(requireAuth(req).userId, req.params.proposalId),
  );

  app.post(
    '/ai/proposals/:proposalId/execute',
    {
      schema: {
        params: z.object({ proposalId: z.uuid() }),
        body: executeProposalBody,
        response: { 200: aiProposal },
      },
    },
    (req) => ai.execute.execute(requireAuth(req).userId, req.params.proposalId, req.body.actionIds),
  );
};

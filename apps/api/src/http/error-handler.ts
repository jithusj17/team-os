import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { ErrorResponse } from '@team-os/shared';
import { DomainError, type ErrorKind } from '../shared/domain/errors.js';

const statusByKind: Record<ErrorKind, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  unavailable: 503,
};

/** Maps domain errors and framework errors to the API's error response format. */
export function registerErrorHandlers(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    const send = (status: number, error: ErrorResponse['error']) =>
      reply.code(status).send({ error } satisfies ErrorResponse);

    if (hasZodFastifySchemaValidationErrors(err)) {
      return send(400, {
        code: 'validation_error',
        message: 'Invalid request',
        details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
      });
    }
    if (err instanceof DomainError) {
      return send(statusByKind[err.kind], { code: err.code, message: err.message });
    }

    // Errors from Fastify and its plugins (bad JSON, payload too large, rate limits, ...).
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return send(e.statusCode, {
        code: typeof e.code === 'string' ? e.code.toLowerCase() : 'bad_request',
        message: e.message ?? 'Bad request',
      });
    }

    req.log.error({ err }, 'Unhandled error');
    return send(500, { code: 'internal_error', message: 'Something went wrong' });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } }),
  );
}

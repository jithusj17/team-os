import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { ErrorResponse } from '@team-os/shared';

/** An error that is safe to show to the client, with a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const unauthorized = (message = 'Sign in required') =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (code = 'forbidden', message = 'You do not have permission to do this') =>
  new AppError(403, code, message);
export const notFound = (code = 'not_found', message = 'Not found') =>
  new AppError(404, code, message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const gone = (code: string, message: string) => new AppError(410, code, message);

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
    if (err instanceof AppError) {
      return send(err.statusCode, { code: err.code, message: err.message });
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

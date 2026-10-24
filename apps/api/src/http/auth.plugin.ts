import cookie from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { forbidden, unauthorized, unavailable } from '../shared/domain/errors.js';

export const SESSION_COOKIE = 'sid';
export const CSRF_HEADER = 'x-csrf-token';

export interface AuthContext {
  userId: string;
  csrfToken: string;
  sessionToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Returns the signed-in user's auth context, or throws unauthorized. */
export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Sets the session cookie. Cookies are an HTTP concern, so they live here, not in use cases. */
export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  const { config } = req.server;
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    maxAge: config.SESSION_MAX_AGE_DAYS * 24 * 60 * 60,
  });
}

/** Resolves the session cookie to `req.auth` and enforces CSRF on state-changing requests. */
export const authPlugin = fp(async (app) => {
  const { sessions, tokens } = app.container;
  await app.register(cookie);
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;

    let session;
    try {
      session = await sessions.get(token);
    } catch (err) {
      // Fail closed: without the session store we cannot tell who the caller is.
      req.log.error({ err }, 'Session store unavailable');
      throw unavailable('session_store_unavailable', 'Service temporarily unavailable');
    }
    if (!session) return;

    req.auth = { userId: session.userId, csrfToken: session.csrfToken, sessionToken: token };

    // Browsers send cookies automatically, so state-changing requests made with a session
    // cookie must also prove they came from our app by echoing the CSRF token.
    if (UNSAFE_METHODS.has(req.method)) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || !tokens.equals(header, session.csrfToken)) {
        throw forbidden('csrf_invalid', 'Missing or invalid CSRF token');
      }
    }
  });
});

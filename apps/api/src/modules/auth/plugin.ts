import cookie from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError, forbidden, unauthorized } from '../../lib/errors.js';
import { safeEqual } from '../../lib/tokens.js';
import { SessionStore } from './sessions.js';

export const SESSION_COOKIE = 'sid';
export const CSRF_HEADER = 'x-csrf-token';

export interface AuthContext {
  userId: string;
  csrfToken: string;
  sessionToken: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    sessions: SessionStore;
    /** Creates a session for `userId` and sets the session cookie on `reply`. */
    startSession(reply: FastifyReply, userId: string): Promise<void>;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Returns the signed-in user's auth context, or throws 401. */
export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export const authPlugin = fp(async (app) => {
  const { config } = app;
  await app.register(cookie);

  const sessions = new SessionStore(app.redis, {
    idleTtlDays: config.SESSION_TTL_DAYS,
    maxAgeDays: config.SESSION_MAX_AGE_DAYS,
  });
  app.decorate('sessions', sessions);

  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.NODE_ENV === 'production',
    maxAge: config.SESSION_MAX_AGE_DAYS * 24 * 60 * 60,
  };

  app.decorate('startSession', async (reply: FastifyReply, userId: string) => {
    const { token } = await sessions.create(userId);
    reply.setCookie(SESSION_COOKIE, token, cookieOptions);
  });

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
      throw new AppError(503, 'session_store_unavailable', 'Service temporarily unavailable');
    }
    if (!session) return;

    req.auth = { userId: session.userId, csrfToken: session.csrfToken, sessionToken: token };

    // Cookies are sent automatically by browsers, so state-changing requests made with a
    // session cookie must also prove they came from our app by echoing the CSRF token.
    if (UNSAFE_METHODS.has(req.method)) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || !safeEqual(header, session.csrfToken)) {
        throw forbidden('csrf_invalid', 'Missing or invalid CSRF token');
      }
    }
  });
});

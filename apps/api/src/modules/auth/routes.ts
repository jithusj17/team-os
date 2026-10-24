import { generateCodeVerifier, generateState } from 'arctic';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  devLoginBody,
  meResponse,
  oauthProviderName,
  providersResponse,
  user,
  type OAuthProviderName,
} from '@team-os/shared';
import { AppError, notFound, unauthorized } from '../../lib/errors.js';
import { SESSION_COOKIE, requireAuth } from './plugin.js';
import type { OAuthProvider } from './providers.js';
import { getUser, upsertOAuthUser, upsertUserByEmail } from './service.js';

const STATE_COOKIE = 'oauth_state';
const STATE_TTL_SECONDS = 600;

const pendingLogin = z.object({
  provider: oauthProviderName,
  codeVerifier: z.string(),
  returnTo: z.string(),
});

/** Only same-site relative paths, so the login flow can't be used as an open redirect. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}

export const authRoutes: FastifyPluginAsyncZod<{ providers: OAuthProvider[] }> = async (
  app,
  opts,
) => {
  const { config } = app;
  const providers = new Map(opts.providers.map((p) => [p.name, p]));
  const authRateLimit = { rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } };

  const getProvider = (name: OAuthProviderName) => {
    const provider = providers.get(name);
    if (!provider) throw notFound('provider_not_configured', `Sign-in with ${name} is not enabled`);
    return provider;
  };

  const redirectToLogin = (error: string) =>
    `${config.WEB_ORIGIN}/login?error=${encodeURIComponent(error)}`;

  app.get('/auth/providers', { schema: { response: { 200: providersResponse } } }, async () => ({
    providers: [...providers.keys()],
    devLogin: config.DEV_LOGIN_ENABLED,
  }));

  app.get(
    '/auth/:provider/start',
    {
      config: authRateLimit,
      schema: {
        params: z.object({ provider: oauthProviderName }),
        querystring: z.object({ returnTo: z.string().optional() }),
      },
    },
    async (req, reply) => {
      const provider = getProvider(req.params.provider);
      const state = generateState();
      const codeVerifier = generateCodeVerifier();

      await app.redis.set(
        `oauth:state:${state}`,
        JSON.stringify({
          provider: provider.name,
          codeVerifier,
          returnTo: safeReturnTo(req.query.returnTo),
        }),
        'EX',
        STATE_TTL_SECONDS,
      );
      // Binding the state to this browser prevents login CSRF (an attacker
      // completing the flow with their own account in the victim's browser).
      reply.setCookie(STATE_COOKIE, state, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
        maxAge: STATE_TTL_SECONDS,
      });
      return reply.redirect(provider.authorizationUrl(state, codeVerifier).toString());
    },
  );

  app.get(
    '/auth/:provider/callback',
    {
      config: authRateLimit,
      schema: {
        params: z.object({ provider: oauthProviderName }),
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const provider = getProvider(req.params.provider);
      const { code, state, error } = req.query;
      const cookieState = req.cookies[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: '/' });

      if (error) return reply.redirect(redirectToLogin('oauth_denied'));
      if (!code || !state || !cookieState || state !== cookieState) {
        return reply.redirect(redirectToLogin('invalid_state'));
      }

      // GETDEL makes each state single-use, so a captured callback URL can't be replayed.
      const raw = await app.redis.getdel(`oauth:state:${state}`);
      const pending = raw ? pendingLogin.safeParse(JSON.parse(raw)) : null;
      if (!pending?.success || pending.data.provider !== provider.name) {
        return reply.redirect(redirectToLogin('invalid_state'));
      }

      let profile;
      try {
        profile = await provider.exchange(code, pending.data.codeVerifier);
      } catch (err) {
        req.log.warn({ err, provider: provider.name }, 'OAuth code exchange failed');
        return reply.redirect(redirectToLogin('oauth_failed'));
      }

      let signedIn;
      try {
        signedIn = await upsertOAuthUser(app.db, provider.name, profile);
      } catch (err) {
        if (err instanceof AppError && err.code === 'email_unverified') {
          return reply.redirect(redirectToLogin('email_unverified'));
        }
        throw err;
      }

      // A fresh session on every sign-in prevents session fixation.
      if (req.auth) await app.sessions.destroy(req.auth.sessionToken);
      await app.startSession(reply, signedIn.id);
      req.log.info({ userId: signedIn.id, provider: provider.name }, 'User signed in');
      return reply.redirect(`${config.WEB_ORIGIN}${pending.data.returnTo}`);
    },
  );

  if (config.DEV_LOGIN_ENABLED) {
    app.post(
      '/auth/dev-login',
      { config: authRateLimit, schema: { body: devLoginBody, response: { 200: user } } },
      async (req, reply) => {
        const signedIn = await upsertUserByEmail(app.db, req.body.email, req.body.name);
        if (req.auth) await app.sessions.destroy(req.auth.sessionToken);
        await app.startSession(reply, signedIn.id);
        return signedIn;
      },
    );
  }

  app.get('/auth/me', { schema: { response: { 200: meResponse } } }, async (req) => {
    const auth = requireAuth(req);
    const current = await getUser(app.db, auth.userId);
    if (!current) {
      // The user was deleted while the session was still alive.
      await app.sessions.destroy(auth.sessionToken);
      throw unauthorized();
    }
    return { user: current, csrfToken: auth.csrfToken };
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.auth) await app.sessions.destroy(req.auth.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
};

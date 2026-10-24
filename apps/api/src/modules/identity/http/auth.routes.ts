import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  devLoginBody,
  meResponse,
  oauthProviderName,
  providersResponse,
  user,
} from '@team-os/shared';
import { SESSION_COOKIE, requireAuth, setSessionCookie } from '../../../http/auth.plugin.js';
import { isSignInFailure } from '../application/oauth-sign-in.js';
import { OAUTH_STATE_TTL_SECONDS } from '../domain/ports.js';

const STATE_COOKIE = 'oauth_state';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { config } = app;
  const identity = app.container.identity;
  const authRateLimit = { rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } };
  const loginPage = (error: string) =>
    `${config.WEB_ORIGIN}/login?error=${encodeURIComponent(error)}`;

  app.get('/auth/providers', { schema: { response: { 200: providersResponse } } }, async () => ({
    providers: identity.providers.names(),
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
      const { state, authorizationUrl } = await identity.startOAuthSignIn.execute({
        provider: req.params.provider,
        returnTo: req.query.returnTo,
      });
      // Bind the state to this browser; the callback must present the same value.
      reply.setCookie(STATE_COOKIE, state, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
        maxAge: OAUTH_STATE_TTL_SECONDS,
      });
      return reply.redirect(authorizationUrl);
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
      const { code, state, error } = req.query;
      const browserState = req.cookies[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: '/' });

      if (error) return reply.redirect(loginPage('oauth_denied'));
      if (!code || !state) return reply.redirect(loginPage('invalid_state'));

      try {
        const result = await identity.completeOAuthSignIn.execute({
          provider: req.params.provider,
          code,
          state,
          browserState,
          currentSessionToken: req.auth?.sessionToken,
        });
        setSessionCookie(req, reply, result.sessionToken);
        req.log.info({ userId: result.user.id, provider: req.params.provider }, 'User signed in');
        return reply.redirect(`${config.WEB_ORIGIN}${result.returnTo}`);
      } catch (err) {
        // This is a browser navigation, so failures go back to the login page, not JSON.
        if (isSignInFailure(err)) {
          req.log.warn({ err, provider: req.params.provider }, 'OAuth sign-in failed');
          return reply.redirect(loginPage(err.code));
        }
        throw err;
      }
    },
  );

  if (config.DEV_LOGIN_ENABLED) {
    app.post(
      '/auth/dev-login',
      { config: authRateLimit, schema: { body: devLoginBody, response: { 200: user } } },
      async (req, reply) => {
        const result = await identity.devSignIn.execute({
          ...req.body,
          currentSessionToken: req.auth?.sessionToken,
        });
        setSessionCookie(req, reply, result.sessionToken);
        return result.user;
      },
    );
  }

  app.get('/auth/me', { schema: { response: { 200: meResponse } } }, async (req) => {
    const auth = requireAuth(req);
    const current = await identity.getCurrentUser.execute(auth);
    return { user: current, csrfToken: auth.csrfToken };
  });

  app.post('/auth/logout', async (req, reply) => {
    await identity.signOut.execute({ sessionToken: req.auth?.sessionToken });
    if (req.auth) app.realtime.disconnectSession(req.auth.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
};

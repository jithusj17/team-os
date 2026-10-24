import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { meResponse } from '@team-os/shared';
import { safeReturnTo } from '../src/modules/auth/routes.js';
import {
  buildTestApp,
  FakeOAuthProvider,
  request,
  resetState,
  signIn,
  testConfig,
  type TestApp,
} from './helpers.js';

const google = new FakeOAuthProvider('google');
const github = new FakeOAuthProvider('github');

google.profiles.set('alice-code', {
  providerUserId: 'g-alice',
  email: 'alice@example.com',
  emailVerified: true,
  name: 'Alice',
  avatarUrl: null,
});
github.profiles.set('alice-gh-code', {
  providerUserId: 'gh-alice',
  email: 'ALICE@example.com',
  emailVerified: true,
  name: 'alice-gh',
  avatarUrl: null,
});
google.profiles.set('unverified-code', {
  providerUserId: 'g-mallory',
  email: 'alice@example.com',
  emailVerified: false,
  name: 'Mallory',
  avatarUrl: null,
});

function cookieValue(setCookie: string | string[] | undefined, name: string) {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const match = all.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0]!.slice(name.length + 1);
}

/** Runs the OAuth start + callback dance and returns the callback response. */
async function oauthLogin(
  app: TestApp,
  provider: 'google' | 'github',
  code: string,
  returnTo = '/',
) {
  const start = await app.inject({
    method: 'GET',
    url: `/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`,
  });
  expect(start.statusCode).toBe(302);
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  const stateCookie = cookieValue(start.headers['set-cookie'], 'oauth_state');
  expect(stateCookie).toBe(state);

  return app.inject({
    method: 'GET',
    url: `/auth/${provider}/callback?code=${code}&state=${state}`,
    headers: { cookie: `oauth_state=${state}` },
  });
}

describe('auth', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await buildTestApp({}, { oauthProviders: [google, github] });
  });
  afterAll(() => app.close());
  beforeEach(() => resetState(app));

  it('lists configured providers', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/providers' });
    expect(res.json()).toEqual({ providers: ['google', 'github'], devLogin: false });
  });

  it('signs in with OAuth, creates the user, and starts a session', async () => {
    const res = await oauthLogin(app, 'google', 'alice-code', '/workspaces/abc');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/workspaces/abc');

    const sid = cookieValue(res.headers['set-cookie'], 'sid');
    expect(sid).toBeTruthy();
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: `sid=${sid}` },
    });
    expect(me.statusCode).toBe(200);
    expect(meResponse.parse(me.json()).user.email).toBe('alice@example.com');
  });

  it('links a second provider to the same user via verified email', async () => {
    const first = await oauthLogin(app, 'google', 'alice-code');
    const second = await oauthLogin(app, 'github', 'alice-gh-code');
    const ids = await Promise.all(
      [first, second].map(async (res) => {
        const sid = cookieValue(res.headers['set-cookie'], 'sid');
        const me = await app.inject({
          method: 'GET',
          url: '/auth/me',
          headers: { cookie: `sid=${sid}` },
        });
        return me.json().user.id;
      }),
    );
    expect(ids[0]).toBe(ids[1]);
  });

  it('refuses to link an account with an unverified email', async () => {
    await oauthLogin(app, 'google', 'alice-code');
    const res = await oauthLogin(app, 'google', 'unverified-code');
    expect(res.headers.location).toBe('http://localhost:5173/login?error=email_unverified');
    expect(cookieValue(res.headers['set-cookie'], 'sid')).toBeUndefined();
  });

  it('rejects a callback whose state does not match the browser cookie', async () => {
    const start = await app.inject({ method: 'GET', url: '/auth/google/start' });
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const res = await app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=alice-code&state=${state}`,
      headers: { cookie: 'oauth_state=attacker-state' },
    });
    expect(res.headers.location).toBe('http://localhost:5173/login?error=invalid_state');
  });

  it('rejects a replayed callback', async () => {
    const start = await app.inject({ method: 'GET', url: '/auth/google/start' });
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const callback = {
      method: 'GET' as const,
      url: `/auth/google/callback?code=alice-code&state=${state}`,
      headers: { cookie: `oauth_state=${state}` },
    };
    expect((await app.inject(callback)).headers.location).toBe('http://localhost:5173/');
    expect((await app.inject(callback)).headers.location).toBe(
      'http://localhost:5173/login?error=invalid_state',
    );
  });

  it('redirects to the login page when the provider exchange fails', async () => {
    const res = await oauthLogin(app, 'google', 'bogus-code');
    expect(res.headers.location).toBe('http://localhost:5173/login?error=oauth_failed');
  });

  it('returns 404 for an unconfigured provider', async () => {
    const solo = await buildTestApp({}, { oauthProviders: [google] });
    try {
      const res = await solo.inject({ method: 'GET', url: '/auth/github/start' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('provider_not_configured');
    } finally {
      await solo.close();
    }
  });

  it('only accepts relative return paths', () => {
    expect(safeReturnTo('/projects/1?x=2')).toBe('/projects/1?x=2');
    expect(safeReturnTo('https://evil.com')).toBe('/');
    expect(safeReturnTo('//evil.com')).toBe('/');
    expect(safeReturnTo('/\\evil.com')).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });

  it('returns 401 from /auth/me without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('logs out and invalidates the session', async () => {
    const user = await signIn(app, 'bob@example.com');
    expect((await request(app, user, 'POST', '/auth/logout')).statusCode).toBe(204);
    expect((await request(app, user, 'GET', '/auth/me')).statusCode).toBe(401);
  });

  it('rejects state-changing requests without a valid CSRF token', async () => {
    const user = await signIn(app, 'bob@example.com');
    const noToken = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'X' },
      headers: { cookie: user.cookie },
    });
    expect(noToken.statusCode).toBe(403);
    expect(noToken.json().error.code).toBe('csrf_invalid');

    const wrongToken = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: { name: 'X' },
      headers: { cookie: user.cookie, 'x-csrf-token': 'nope' },
    });
    expect(wrongToken.statusCode).toBe(403);

    expect((await request(app, user, 'POST', '/workspaces', { name: 'X' })).statusCode).toBe(201);
  });

  it('does not expose dev login unless enabled', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/dev-login',
      payload: { email: 'a@example.com' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('dev login', () => {
  it('signs in by email when enabled', async () => {
    const app = await buildTestApp({ DEV_LOGIN_ENABLED: 'true' }, { oauthProviders: [] });
    try {
      await resetState(app);
      const res = await app.inject({
        method: 'POST',
        url: '/auth/dev-login',
        payload: { email: 'dev@example.com', name: 'Dev' },
      });
      expect(res.statusCode).toBe(200);
      expect(cookieValue(res.headers['set-cookie'], 'sid')).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('cannot be enabled in production', () => {
    expect(() => testConfig({ NODE_ENV: 'production', DEV_LOGIN_ENABLED: 'true' })).toThrow(
      /DEV_LOGIN_ENABLED must not be set in production/,
    );
  });
});

describe('rate limiting', () => {
  it('limits auth endpoints per client', async () => {
    const app = await buildTestApp({ AUTH_RATE_LIMIT_MAX: '3' }, { oauthProviders: [google] });
    try {
      await resetState(app);
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        codes.push((await app.inject({ method: 'GET', url: '/auth/google/start' })).statusCode);
      }
      expect(codes).toEqual([302, 302, 302, 429]);
      const last = await app.inject({ method: 'GET', url: '/auth/google/start' });
      expect(last.json().error.code).toBe('rate_limited');
    } finally {
      await app.close();
    }
  });
});

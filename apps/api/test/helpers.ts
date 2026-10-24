import type { InjectOptions } from 'fastify';
import type { OAuthProviderName, WorkspaceRole } from '@team-os/shared';
import { buildApp, type BuildAppOptions } from '../src/app.js';
import { loadConfig } from '../src/config.js';

import type { OAuthProvider } from '../src/modules/identity/domain/ports.js';
import type { OAuthProfile } from '../src/modules/identity/domain/user.js';

export type TestApp = Awaited<ReturnType<typeof buildApp>>;

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL:
      process.env.TEST_DATABASE_URL ?? 'postgres://teamos:teamos@localhost:5433/teamos_test',
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/1',
    ...overrides,
  });
}

export function buildTestApp(
  overrides: Record<string, string> = {},
  options: BuildAppOptions = {},
) {
  return buildApp(testConfig(overrides), options);
}

/** Clears all data between tests. Tests run one file at a time, so this is safe. */
export async function resetState(app: TestApp) {
  await app.sql`TRUNCATE users, oauth_accounts, workspaces, workspace_members, workspace_invites CASCADE`;
  await app.redis.flushdb();
}

/** An OAuth provider whose `exchange` returns profiles registered against a code. */
export class FakeOAuthProvider implements OAuthProvider {
  readonly profiles = new Map<string, OAuthProfile>();
  constructor(readonly name: OAuthProviderName) {}

  authorizationUrl(state: string) {
    return new URL(`https://oauth.test/${this.name}/authorize?state=${state}`);
  }

  async exchange(code: string) {
    const profile = this.profiles.get(code);
    if (!profile) throw new Error('invalid code');
    return profile;
  }
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  cookie: string;
  csrf: string;
}

/** Creates (or reuses) a user and a live session for them. */
export async function signIn(app: TestApp, email: string, name?: string): Promise<TestUser> {
  const { user, sessionToken, csrfToken } = await app.container.identity.devSignIn.execute({
    email,
    name,
  });
  return { ...user, cookie: `sid=${sessionToken}`, csrf: csrfToken };
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Sends a request as `user` (with session cookie and CSRF header), or anonymously. */
export function request(
  app: TestApp,
  user: TestUser | null,
  method: Method,
  url: string,
  payload?: InjectOptions['payload'],
) {
  return app.inject({
    method,
    url,
    payload,
    headers: user ? { cookie: user.cookie, 'x-csrf-token': user.csrf } : {},
  });
}

/** A workspace with one user per role, plus a signed-in user who is not a member. */
export async function setupWorkspace(app: TestApp) {
  const owner = await signIn(app, 'owner@example.com', 'Olivia Owner');
  const { container } = app;
  const workspace = await container.workspaces.create.execute(owner.id, { name: 'Acme' });
  const users = { owner } as Record<WorkspaceRole, TestUser>;
  for (const role of ['admin', 'member', 'guest'] as const) {
    const user = await signIn(app, `${role}@example.com`, `${role} user`);
    await container.uow.repos.members.add(workspace.id, user.id, role);
    users[role] = user;
  }
  const outsider = await signIn(app, 'outsider@example.com', 'Outsider');
  return { workspace, ...users, outsider };
}

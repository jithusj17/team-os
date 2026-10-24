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
  // Every other table references users or workspaces, so CASCADE clears them all.
  await app.sql`TRUNCATE users, workspaces CASCADE`;
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

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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

/** Shorthand for a JSON request that must succeed with `status`; returns the parsed body. */
export async function ok<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any -- test convenience
  app: TestApp,
  user: TestUser | null,
  method: Method,
  url: string,
  payload?: InjectOptions['payload'],
  status = method === 'POST' ? 201 : 200,
): Promise<T> {
  const res = await request(app, user, method, url, payload);
  if (res.statusCode !== status) {
    throw new Error(`${method} ${url} -> ${res.statusCode} (expected ${status}): ${res.body}`);
  }
  return res.body ? (res.json() as T) : (undefined as T);
}

/** A workspace (see setupWorkspace) plus a workspace-visible project created by the owner. */
export async function setupProject(app: TestApp) {
  const ctx = await setupWorkspace(app);
  const project = await app.container.projects.create.execute(ctx.owner.id, ctx.workspace.id, {
    name: 'Engineering',
    key: 'ENG',
    description: '',
    visibility: 'workspace',
  });
  const status = (name: string) => project.statuses.find((s) => s.name === name)!;
  return { ...ctx, project, status };
}

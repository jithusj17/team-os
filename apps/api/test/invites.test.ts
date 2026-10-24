import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emailJob, QUEUES } from '@team-os/shared';

import {
  buildTestApp,
  request,
  resetState,
  setupWorkspace,
  signIn,
  type TestApp,
} from './helpers.js';

describe('invites', () => {
  let app: TestApp;
  let ctx: Awaited<ReturnType<typeof setupWorkspace>>;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetState(app);
    ctx = await setupWorkspace(app);
  });

  const url = (path = '') => `/workspaces/${ctx.workspace.id}${path}`;
  const tokenFrom = (acceptUrl: string) => acceptUrl.split('/invites/')[1]!;

  async function invite(email: string, role = 'member', as = ctx.admin) {
    const res = await request(app, as, 'POST', url('/invites'), { email, role });
    expect(res.statusCode).toBe(201);
    return { ...res.json(), token: tokenFrom(res.json().acceptUrl) };
  }

  it('creates an invite and queues the invite email', async () => {
    const created = await invite('New.Person@Example.com');
    expect(created.invite).toMatchObject({ email: 'new.person@example.com', role: 'member' });
    expect(created.acceptUrl).toMatch(/^http:\/\/localhost:5173\/invites\/.+/);

    const jobs = await app.container.jobs.queue(QUEUES.email).getJobs(['waiting', 'delayed']);
    expect(jobs).toHaveLength(1);
    expect(emailJob.parse(jobs[0]!.data)).toMatchObject({
      type: 'workspace-invite',
      to: 'new.person@example.com',
      workspaceName: 'Acme',
      acceptUrl: created.acceptUrl,
    });
  });

  it('enforces who can invite which role', async () => {
    const cases = [
      { as: ctx.member, role: 'member', status: 403 },
      { as: ctx.guest, role: 'guest', status: 403 },
      { as: ctx.admin, role: 'admin', status: 403 },
      { as: ctx.owner, role: 'admin', status: 201 },
      { as: ctx.owner, role: 'owner', status: 400 },
    ];
    for (const [i, c] of cases.entries()) {
      const res = await request(app, c.as, 'POST', url('/invites'), {
        email: `p${i}@example.com`,
        role: c.role,
      });
      expect(res.statusCode, JSON.stringify(c.role)).toBe(c.status);
    }
  });

  it('rejects inviting an existing member', async () => {
    const res = await request(app, ctx.admin, 'POST', url('/invites'), {
      email: 'MEMBER@example.com',
      role: 'member',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('already_member');
  });

  it('replaces the previous open invite when re-inviting the same email', async () => {
    const first = await invite('dup@example.com');
    await invite('dup@example.com', 'guest');

    const list = await request(app, ctx.admin, 'GET', url('/invites'));
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].role).toBe('guest');

    const preview = await request(app, ctx.outsider, 'GET', `/invites/${first.token}`);
    expect(preview.json().status).toBe('revoked');
  });

  it('accepts an invite when the signed-in email matches', async () => {
    const created = await invite('Outsider@Example.com', 'member');

    const preview = await request(app, ctx.outsider, 'GET', `/invites/${created.token}`);
    expect(preview.json()).toMatchObject({
      workspaceName: 'Acme',
      status: 'pending',
      invitedByName: 'admin user',
    });

    const res = await request(app, ctx.outsider, 'POST', `/invites/${created.token}/accept`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ workspaceId: ctx.workspace.id });

    const ws = await request(app, ctx.outsider, 'GET', url());
    expect(ws.json().role).toBe('member');

    const again = await request(app, ctx.outsider, 'POST', `/invites/${created.token}/accept`);
    expect(again.statusCode).toBe(409);
  });

  it('refuses an invite accepted by a different account', async () => {
    const created = await invite('someone-else@example.com');
    const res = await request(app, ctx.outsider, 'POST', `/invites/${created.token}/accept`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('invite_email_mismatch');
  });

  it('refuses revoked and expired invites', async () => {
    const revoked = await invite('outsider@example.com');
    expect(
      (await request(app, ctx.admin, 'DELETE', url(`/invites/${revoked.invite.id}`))).statusCode,
    ).toBe(204);
    const r1 = await request(app, ctx.outsider, 'POST', `/invites/${revoked.token}/accept`);
    expect(r1.statusCode).toBe(410);
    expect(r1.json().error.code).toBe('invite_revoked');

    const expired = await invite('outsider@example.com');
    await app.sql`update workspace_invites set expires_at = now() - interval '1 second'`;
    const r2 = await request(app, ctx.outsider, 'POST', `/invites/${expired.token}/accept`);
    expect(r2.statusCode).toBe(410);
    expect(r2.json().error.code).toBe('invite_expired');
  });

  it('requires sign-in to view or accept invites', async () => {
    const created = await invite('x@example.com');
    expect((await request(app, null, 'GET', `/invites/${created.token}`)).statusCode).toBe(401);
    expect((await request(app, null, 'POST', `/invites/${created.token}/accept`)).statusCode).toBe(
      401,
    );
  });

  it('returns 404 for an unknown token', async () => {
    const user = await signIn(app, 'x@example.com');
    const res = await request(app, user, 'GET', `/invites/${'a'.repeat(43)}`);
    expect(res.statusCode).toBe(404);
  });

  it('restricts listing and revoking invites to admins', async () => {
    const created = await invite('x@example.com');
    expect((await request(app, ctx.member, 'GET', url('/invites'))).statusCode).toBe(403);
    expect(
      (await request(app, ctx.member, 'DELETE', url(`/invites/${created.invite.id}`))).statusCode,
    ).toBe(403);
  });
});

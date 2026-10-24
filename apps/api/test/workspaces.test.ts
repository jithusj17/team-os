import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceRole } from '@team-os/shared';
import {
  buildTestApp,
  request,
  resetState,
  setupWorkspace,
  signIn,
  type TestApp,
} from './helpers.js';

describe('workspaces', () => {
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
  const roles: WorkspaceRole[] = ['owner', 'admin', 'member', 'guest'];

  it('requires sign-in', async () => {
    const res = await request(app, null, 'GET', '/workspaces');
    expect(res.statusCode).toBe(401);
  });

  it('creates a workspace with the creator as owner and a derived slug', async () => {
    const user = await signIn(app, 'new@example.com');
    const res = await request(app, user, 'POST', '/workspaces', { name: 'Rocket Team!' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Rocket Team!', slug: 'rocket-team', role: 'owner' });

    const list = await request(app, user, 'GET', '/workspaces');
    expect(list.json()).toHaveLength(1);
  });

  it('adds a suffix when a derived slug is taken, but rejects a taken explicit slug', async () => {
    const user = await signIn(app, 'new@example.com');
    const second = await request(app, user, 'POST', '/workspaces', { name: 'Acme' });
    expect(second.json().slug).toMatch(/^acme-[0-9a-f]{6}$/);

    const explicit = await request(app, user, 'POST', '/workspaces', { name: 'X', slug: 'acme' });
    expect(explicit.statusCode).toBe(409);
    expect(explicit.json().error.code).toBe('slug_taken');
  });

  it('validates input', async () => {
    const res = await request(app, ctx.owner, 'POST', '/workspaces', {
      name: '',
      slug: 'Bad Slug',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('hides workspaces from non-members with 404', async () => {
    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const res = await request(
        app,
        ctx.outsider,
        method,
        url(),
        method === 'PATCH' ? { name: 'x' } : undefined,
      );
      expect(res.statusCode, method).toBe(404);
    }
    expect((await request(app, ctx.outsider, 'GET', url('/members'))).statusCode).toBe(404);
  });

  it('lets every member read the workspace with their own role', async () => {
    for (const role of roles) {
      const res = await request(app, ctx[role], 'GET', url());
      expect(res.statusCode).toBe(200);
      expect(res.json().role).toBe(role);
    }
  });

  it('allows only owners and admins to update the workspace', async () => {
    const expected = { owner: 200, admin: 200, member: 403, guest: 403 };
    for (const role of roles) {
      const res = await request(app, ctx[role], 'PATCH', url(), { name: `Renamed by ${role}` });
      expect(res.statusCode, role).toBe(expected[role]);
    }
  });

  it('allows only owners to delete the workspace', async () => {
    for (const role of ['admin', 'member', 'guest'] as const) {
      expect((await request(app, ctx[role], 'DELETE', url())).statusCode, role).toBe(403);
    }
    expect((await request(app, ctx.owner, 'DELETE', url())).statusCode).toBe(204);
    expect((await request(app, ctx.owner, 'GET', url())).statusCode).toBe(404);
  });

  describe('members', () => {
    it('lists members for everyone except guests', async () => {
      const expected = { owner: 200, admin: 200, member: 200, guest: 403 };
      for (const role of roles) {
        const res = await request(app, ctx[role], 'GET', url('/members'));
        expect(res.statusCode, role).toBe(expected[role]);
      }
      const res = await request(app, ctx.owner, 'GET', url('/members'));
      expect(res.json()).toHaveLength(4);
    });

    it('lets admins change member/guest roles but not promote to admin', async () => {
      const toGuest = await request(app, ctx.admin, 'PATCH', url(`/members/${ctx.member.id}`), {
        role: 'guest',
      });
      expect(toGuest.statusCode).toBe(204);

      const toAdmin = await request(app, ctx.admin, 'PATCH', url(`/members/${ctx.guest.id}`), {
        role: 'admin',
      });
      expect(toAdmin.statusCode).toBe(403);
    });

    it('lets owners promote to owner, then step down', async () => {
      const promote = await request(app, ctx.owner, 'PATCH', url(`/members/${ctx.admin.id}`), {
        role: 'owner',
      });
      expect(promote.statusCode).toBe(204);
      const stepDown = await request(app, ctx.owner, 'PATCH', url(`/members/${ctx.owner.id}`), {
        role: 'member',
      });
      expect(stepDown.statusCode).toBe(204);
    });

    it('never removes or demotes the last owner', async () => {
      const demote = await request(app, ctx.owner, 'PATCH', url(`/members/${ctx.owner.id}`), {
        role: 'admin',
      });
      expect(demote.statusCode).toBe(409);
      expect(demote.json().error.code).toBe('last_owner');

      const leave = await request(app, ctx.owner, 'DELETE', url(`/members/${ctx.owner.id}`));
      expect(leave.statusCode).toBe(409);
    });

    it('lets admins remove members and guests but not other admins', async () => {
      await request(app, ctx.owner, 'PATCH', url(`/members/${ctx.member.id}`), { role: 'admin' });
      const remove = (as: typeof ctx.admin, target: typeof ctx.admin) =>
        request(app, as, 'DELETE', url(`/members/${target.id}`)).then((r) => r.statusCode);

      expect(await remove(ctx.admin, ctx.member)).toBe(403); // now an admin
      expect(await remove(ctx.admin, ctx.owner)).toBe(403);
      expect(await remove(ctx.admin, ctx.guest)).toBe(204);
      expect(await remove(ctx.owner, ctx.member)).toBe(204);
    });

    it('lets anyone leave', async () => {
      expect(
        (await request(app, ctx.guest, 'DELETE', url(`/members/${ctx.guest.id}`))).statusCode,
      ).toBe(204);
      expect((await request(app, ctx.guest, 'GET', url())).statusCode).toBe(404);
    });

    it('returns 404 for a user who is not a member', async () => {
      const res = await request(app, ctx.owner, 'PATCH', url(`/members/${ctx.outsider.id}`), {
        role: 'member',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('member_not_found');
    });
  });
});

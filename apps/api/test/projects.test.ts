import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  ok,
  request,
  resetState,
  setupProject,
  setupWorkspace,
  type TestApp,
} from './helpers.js';

describe('projects', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => resetState(app));

  describe('creating', () => {
    it('lets members create projects with default statuses and makes them admin', async () => {
      const ctx = await setupWorkspace(app);
      const project = await ok(
        app,
        ctx.member,
        'POST',
        `/workspaces/${ctx.workspace.id}/projects`,
        {
          name: 'Engineering',
          key: 'eng',
        },
      );
      expect(project).toMatchObject({ key: 'ENG', role: 'admin', visibility: 'workspace' });
      expect(project.statuses.map((s: { name: string }) => s.name)).toEqual([
        'Backlog',
        'Todo',
        'In Progress',
        'In Review',
        'Done',
        'Canceled',
      ]);
    });

    it('refuses guests, duplicate keys and malformed keys', async () => {
      const ctx = await setupWorkspace(app);
      const url = `/workspaces/${ctx.workspace.id}/projects`;
      expect(
        (await request(app, ctx.guest, 'POST', url, { name: 'X', key: 'XX' })).statusCode,
      ).toBe(403);
      await ok(app, ctx.member, 'POST', url, { name: 'A', key: 'ENG' });
      const dup = await request(app, ctx.admin, 'POST', url, { name: 'B', key: 'eng' });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.code).toBe('project_key_taken');
      expect(
        (await request(app, ctx.admin, 'POST', url, { name: 'C', key: '1AB' })).statusCode,
      ).toBe(400);
    });
  });

  describe('visibility and roles', () => {
    it('shows workspace projects to members as editors and hides them from guests', async () => {
      const ctx = await setupProject(app);
      const url = `/projects/${ctx.project.id}`;
      expect((await ok(app, ctx.member, 'GET', url)).role).toBe('editor');
      expect((await ok(app, ctx.admin, 'GET', url)).role).toBe('admin');
      expect((await request(app, ctx.guest, 'GET', url)).statusCode).toBe(404);
      expect((await request(app, ctx.outsider, 'GET', url)).statusCode).toBe(404);

      await ok(app, ctx.owner, 'PUT', `${url}/members/${ctx.guest.id}`, { role: 'viewer' }, 204);
      expect((await ok(app, ctx.guest, 'GET', url)).role).toBe('viewer');
    });

    it('hides private projects from members unless they are added', async () => {
      const ctx = await setupProject(app);
      const url = `/projects/${ctx.project.id}`;
      await ok(app, ctx.owner, 'PATCH', url, { visibility: 'private' });

      expect((await request(app, ctx.member, 'GET', url)).statusCode).toBe(404);
      const listed = await ok(app, ctx.member, 'GET', `/workspaces/${ctx.workspace.id}/projects`);
      expect(listed).toEqual([]);

      await ok(app, ctx.owner, 'PUT', `${url}/members/${ctx.member.id}`, { role: 'editor' }, 204);
      expect((await ok(app, ctx.member, 'GET', url)).role).toBe('editor');
      // Workspace admins always see every project.
      expect((await ok(app, ctx.admin, 'GET', url)).role).toBe('admin');
    });

    it('lets an explicit role limit a member below the default', async () => {
      const ctx = await setupProject(app);
      const url = `/projects/${ctx.project.id}`;
      await ok(app, ctx.owner, 'PUT', `${url}/members/${ctx.member.id}`, { role: 'viewer' }, 204);
      expect((await ok(app, ctx.member, 'GET', url)).role).toBe('viewer');
      const create = await request(app, ctx.member, 'POST', `${url}/tasks`, { title: 'x' });
      expect(create.statusCode).toBe(403);
    });

    it('allows only project admins to update, delete and manage members', async () => {
      const ctx = await setupProject(app);
      const url = `/projects/${ctx.project.id}`;
      expect((await request(app, ctx.member, 'PATCH', url, { name: 'X' })).statusCode).toBe(403);
      expect((await request(app, ctx.member, 'DELETE', url)).statusCode).toBe(403);
      expect(
        (
          await request(app, ctx.member, 'PUT', `${url}/members/${ctx.guest.id}`, {
            role: 'viewer',
          })
        ).statusCode,
      ).toBe(403);
      expect((await ok(app, ctx.admin, 'PATCH', url, { name: 'Platform' })).name).toBe('Platform');
      await ok(app, ctx.owner, 'DELETE', url, undefined, 204);
      expect((await request(app, ctx.owner, 'GET', url)).statusCode).toBe(404);
    });

    it('only adds workspace members to projects', async () => {
      const ctx = await setupProject(app);
      const res = await request(
        app,
        ctx.owner,
        'PUT',
        `/projects/${ctx.project.id}/members/${ctx.outsider.id}`,
        { role: 'viewer' },
      );
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('member_not_found');
    });
  });

  describe('statuses', () => {
    it('creates, renames and reorders statuses', async () => {
      const ctx = await setupProject(app);
      const url = `/projects/${ctx.project.id}/statuses`;
      const qa = await ok(app, ctx.owner, 'POST', url, { name: 'QA', category: 'in_progress' });
      expect(qa.position).toBe(6);

      const dup = await request(app, ctx.owner, 'PATCH', `${url}/${qa.id}`, { name: 'done' });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.code).toBe('status_name_taken');

      const ids = [qa.id, ...ctx.project.statuses.map((s) => s.id)];
      const reordered = await ok(app, ctx.owner, 'PUT', `${url}/order`, { statusIds: ids });
      expect(reordered[0].name).toBe('QA');

      const partial = await request(app, ctx.owner, 'PUT', `${url}/order`, { statusIds: [qa.id] });
      expect(partial.statusCode).toBe(400);
    });

    it('requires moving tasks before deleting a status in use', async () => {
      const ctx = await setupProject(app);
      const todo = ctx.status('Todo');
      const done = ctx.status('Done');
      const task = await ok(app, ctx.owner, 'POST', `/projects/${ctx.project.id}/tasks`, {
        title: 'Write spec',
        statusId: todo.id,
      });
      const url = `/projects/${ctx.project.id}/statuses/${todo.id}`;

      const inUse = await request(app, ctx.owner, 'DELETE', url);
      expect(inUse.statusCode).toBe(409);
      expect(inUse.json().error.code).toBe('status_in_use');

      await ok(app, ctx.owner, 'DELETE', `${url}?moveTo=${done.id}`, undefined, 204);
      expect((await ok(app, ctx.owner, 'GET', `/tasks/${task.id}`)).statusId).toBe(done.id);
    });

    it('keeps at least one status and limits management to admins', async () => {
      const ctx = await setupProject(app);
      const url = `/projects/${ctx.project.id}/statuses`;
      expect(
        (await request(app, ctx.member, 'POST', url, { name: 'X', category: 'todo' })).statusCode,
      ).toBe(403);

      const [last, ...rest] = ctx.project.statuses;
      for (const s of rest) await ok(app, ctx.owner, 'DELETE', `${url}/${s.id}`, undefined, 204);
      const res = await request(app, ctx.owner, 'DELETE', `${url}/${last!.id}`);
      expect(res.json().error.code).toBe('last_status');
    });
  });
});

describe('project people', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(() => app.close());
  beforeEach(() => resetState(app));

  it('lists everyone with access and their effective role, visible to guests in the project', async () => {
    const ctx = await setupProject(app);
    const url = `/projects/${ctx.project.id}`;
    await ok(app, ctx.owner, 'PUT', `${url}/members/${ctx.guest.id}`, { role: 'viewer' }, 204);

    const people = await ok(app, ctx.guest, 'GET', `${url}/people`);
    const roles = Object.fromEntries(
      people.map((p: { email: string; role: string }) => [p.email, p.role]),
    );
    expect(roles).toEqual({
      'owner@example.com': 'admin',
      'admin@example.com': 'admin',
      'member@example.com': 'editor',
      'guest@example.com': 'viewer',
    });

    await ok(app, ctx.owner, 'PATCH', url, { visibility: 'private' });
    const privatePeople = await ok(app, ctx.owner, 'GET', `${url}/people`);
    expect(privatePeople.map((p: { email: string }) => p.email).sort()).toEqual([
      'admin@example.com',
      'guest@example.com',
      'owner@example.com',
    ]);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '@team-os/shared';
import { buildTestApp, ok, request, resetState, setupProject, type TestApp } from './helpers.js';

describe('tasks', () => {
  let app: TestApp;
  let ctx: Awaited<ReturnType<typeof setupProject>>;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetState(app);
    ctx = await setupProject(app);
  });

  const tasksUrl = () => `/projects/${ctx.project.id}/tasks`;
  const create = (body: Record<string, unknown>, as = ctx.owner) =>
    ok<Task>(app, as, 'POST', tasksUrl(), body);
  const update = (t: Pick<Task, 'id' | 'version'>, body: Record<string, unknown>, as = ctx.owner) =>
    ok<Task>(app, as, 'PATCH', `/tasks/${t.id}`, { version: t.version, ...body });
  const list = (query = '', as = ctx.owner) =>
    ok<{ items: Task[]; nextCursor: string | null }>(app, as, 'GET', `${tasksUrl()}?${query}`);

  describe('creating', () => {
    it('numbers tasks per project and defaults to the Todo status', async () => {
      const a = await create({ title: 'First' });
      const b = await create({ title: 'Second' });
      expect([a.key, b.key]).toEqual(['ENG-1', 'ENG-2']);
      expect(a.statusId).toBe(ctx.status('Todo').id);
      expect(a).toMatchObject({ priority: 'none', version: 1, labels: [], subtaskCount: 0 });

      const found = await ok(
        app,
        ctx.member,
        'GET',
        `/workspaces/${ctx.workspace.id}/tasks/by-key/eng-2`,
      );
      expect(found.id).toBe(b.id);
    });

    it('gives concurrent creates distinct numbers', async () => {
      const created = await Promise.all(
        Array.from({ length: 10 }, (_, i) => create({ title: `Task ${i}` })),
      );
      expect(created.map((t) => t.number).sort((x, y) => x - y)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
    });

    it('enforces project access', async () => {
      await ok(
        app,
        ctx.owner,
        'PUT',
        `/projects/${ctx.project.id}/members/${ctx.guest.id}`,
        { role: 'viewer' },
        204,
      );
      expect((await request(app, ctx.guest, 'POST', tasksUrl(), { title: 'x' })).statusCode).toBe(
        403,
      );
      expect(
        (await request(app, ctx.outsider, 'POST', tasksUrl(), { title: 'x' })).statusCode,
      ).toBe(404);
      const t = await create({ title: 'Secret' });
      expect((await request(app, ctx.outsider, 'GET', `/tasks/${t.id}`)).statusCode).toBe(404);
      expect((await ok(app, ctx.guest, 'GET', `/tasks/${t.id}`)).title).toBe('Secret');
    });

    it('rejects references that do not belong to the project', async () => {
      const other = await app.container.projects.create.execute(ctx.owner.id, ctx.workspace.id, {
        name: 'Other',
        key: 'OPS',
        description: '',
        visibility: 'workspace',
      });
      const otherTask = await app.container.tasks.create.execute(ctx.owner.id, other.id, {
        title: 'x',
        description: '',
        priority: 'none',
        assigneeId: null,
        labelIds: [],
        dueDate: null,
        estimate: null,
        parentId: null,
      });
      const cases: [Record<string, unknown>, string][] = [
        [{ statusId: other.statuses[0]!.id }, 'invalid_status'],
        [{ assigneeId: ctx.guest.id }, 'invalid_assignee'], // guest can't see the project
        [{ assigneeId: ctx.outsider.id }, 'invalid_assignee'],
        [{ labelIds: ['00000000-0000-4000-8000-000000000000'] }, 'invalid_label'],
        [{ parentId: otherTask.id }, 'invalid_parent'],
      ];
      for (const [body, code] of cases) {
        const res = await request(app, ctx.owner, 'POST', tasksUrl(), { title: 'x', ...body });
        expect(res.statusCode, code).toBe(400);
        expect(res.json().error.code).toBe(code);
      }
    });
  });

  describe('updating', () => {
    it('rejects updates made from a stale version', async () => {
      const t = await create({ title: 'Original' });
      const first = await update(t, { title: 'Alice edit' });
      expect(first.version).toBe(2);

      const stale = await request(app, ctx.member, 'PATCH', `/tasks/${t.id}`, {
        version: t.version,
        title: 'Bob edit',
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('version_conflict');
      expect((await ok(app, ctx.owner, 'GET', `/tasks/${t.id}`)).title).toBe('Alice edit');
    });

    it('lets only one of two simultaneous updates win', async () => {
      const t = await create({ title: 'Race' });
      const results = await Promise.all(
        ['A', 'B'].map((title) =>
          request(app, ctx.owner, 'PATCH', `/tasks/${t.id}`, { version: t.version, title }),
        ),
      );
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    });

    it('records field changes in the activity log', async () => {
      const label = await ok(app, ctx.owner, 'POST', `/workspaces/${ctx.workspace.id}/labels`, {
        name: 'bug',
      });
      const t = await create({ title: 'Fix login' });
      await update(t, {
        priority: 'high',
        assigneeId: ctx.member.id,
        labelIds: [label.id],
        description: 'Steps to reproduce...',
      });
      const activity = await ok(app, ctx.owner, 'GET', `/tasks/${t.id}/activity`);
      expect(activity.map((a: { type: string }) => a.type)).toEqual([
        'task.created',
        'task.updated',
      ]);
      expect(activity[1].changes).toEqual({
        priority: { from: 'none', to: 'high' },
        assigneeId: { from: null, to: ctx.member.id },
        description: { from: null, to: null },
        labels: { from: [], to: [label.id] },
      });
      expect(activity[1].actorId).toBe(ctx.owner.id);
    });

    it('sets completedAt when moved to a done status and clears it when reopened', async () => {
      const t = await create({ title: 'Ship it' });
      const done = await update(t, { statusId: ctx.status('Done').id });
      expect(done.completedAt).not.toBeNull();
      const reopened = await update(done, { statusId: ctx.status('Todo').id });
      expect(reopened.completedAt).toBeNull();
    });

    it('prevents nesting a task under its own subtask', async () => {
      const parent = await create({ title: 'Epic' });
      const child = await create({ title: 'Story', parentId: parent.id });
      expect((await ok(app, ctx.owner, 'GET', `/tasks/${parent.id}`)).subtaskCount).toBe(1);

      const res = await request(app, ctx.owner, 'PATCH', `/tasks/${parent.id}`, {
        version: parent.version,
        parentId: child.id,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('parent_cycle');
    });

    it('does not let viewers edit', async () => {
      const t = await create({ title: 'x' });
      await ok(
        app,
        ctx.owner,
        'PUT',
        `/projects/${ctx.project.id}/members/${ctx.member.id}`,
        { role: 'viewer' },
        204,
      );
      const res = await request(app, ctx.member, 'PATCH', `/tasks/${t.id}`, {
        version: 1,
        title: 'y',
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('board ordering', () => {
    const titlesInOrder = async (statusId: string) =>
      (await list(`status=${statusId}&sort=position`)).items.map((t) => t.title);

    it('places a task between two neighbours', async () => {
      const a = await create({ title: 'A' });
      const b = await create({ title: 'B' });
      const c = await create({ title: 'C' });
      await update(c, { position: { afterTaskId: a.id, beforeTaskId: b.id } });
      expect(await titlesInOrder(ctx.status('Todo').id)).toEqual(['A', 'C', 'B']);

      await update(a, { position: { afterTaskId: b.id, beforeTaskId: null } });
      expect(await titlesInOrder(ctx.status('Todo').id)).toEqual(['C', 'B', 'A']);
    });

    it('moves a task into another column at the given position', async () => {
      const inProgress = ctx.status('In Progress').id;
      const x = await create({ title: 'X', statusId: inProgress });
      const y = await create({ title: 'Y', statusId: inProgress });
      const t = await create({ title: 'T' });
      await update(t, {
        statusId: inProgress,
        position: { afterTaskId: null, beforeTaskId: x.id },
      });
      expect(await titlesInOrder(inProgress)).toEqual(['T', 'X', 'Y']);

      const bad = await request(app, ctx.owner, 'PATCH', `/tasks/${y.id}`, {
        version: y.version,
        statusId: ctx.status('Done').id,
        position: { afterTaskId: x.id, beforeTaskId: null }, // x is not in Done
      });
      expect(bad.json().error.code).toBe('invalid_position');
    });

    it('rebalances a column when positions run out of precision', async () => {
      const a = await create({ title: 'A' });
      const b = await create({ title: 'B' });
      const c = await create({ title: 'C' });
      await app.sql`update tasks set sort_order = 1 where id = ${a.id}`;
      await app.sql`update tasks set sort_order = 1.0000000001 where id = ${b.id}`;
      await update(c, { position: { afterTaskId: a.id, beforeTaskId: b.id } });
      expect(await titlesInOrder(ctx.status('Todo').id)).toEqual(['A', 'C', 'B']);
    });
  });

  describe('listing', () => {
    it('filters by assignee, label, priority, parent and search', async () => {
      const bug = await ok(app, ctx.owner, 'POST', `/workspaces/${ctx.workspace.id}/labels`, {
        name: 'bug',
      });
      const parent = await create({
        title: 'Login epic',
        assigneeId: ctx.owner.id,
        priority: 'urgent',
      });
      await create({
        title: 'Fix login button',
        parentId: parent.id,
        labelIds: [bug.id],
        priority: 'high',
      });
      await create({ title: 'Write docs', assigneeId: ctx.member.id });

      const titles = async (q: string) => (await list(q)).items.map((t) => t.title).sort();
      expect(await titles('assignee=me')).toEqual(['Login epic']);
      expect(await titles('assignee=none')).toEqual(['Fix login button']);
      expect(await titles(`assignee=${ctx.member.id},none`)).toEqual([
        'Fix login button',
        'Write docs',
      ]);
      expect(await titles(`label=${bug.id}`)).toEqual(['Fix login button']);
      expect(await titles('priority=urgent,high')).toEqual(['Fix login button', 'Login epic']);
      expect(await titles('parent=none')).toEqual(['Login epic', 'Write docs']);
      expect(await titles(`parent=${parent.id}`)).toEqual(['Fix login button']);
      expect(await titles('q=LOGIN')).toEqual(['Fix login button', 'Login epic']);
      expect(await titles('q=100%25')).toEqual([]); // "%" is matched literally
    });

    it('paginates with a cursor without skipping or repeating tasks', async () => {
      for (let i = 1; i <= 7; i++)
        await create({ title: `T${i}`, priority: i % 2 ? 'high' : 'low' });

      for (const sort of ['created', 'priority', 'position', 'due', 'updated']) {
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const page: { items: Task[]; nextCursor: string | null } = await list(
            `sort=${sort}&limit=3${cursor ? `&cursor=${cursor}` : ''}`,
          );
          seen.push(...page.items.map((t) => t.title));
          cursor = page.nextCursor;
        } while (cursor);
        expect(seen, sort).toHaveLength(7);
        expect(new Set(seen).size, sort).toBe(7);
      }

      const byPriority = (await list('sort=priority')).items.map((t) => t.priority);
      expect(byPriority.slice(0, 4)).toEqual(['high', 'high', 'high', 'high']);
    });

    it('rejects malformed cursors', async () => {
      const res = await request(app, ctx.owner, 'GET', `${tasksUrl()}?cursor=garbage`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_cursor');
    });
  });

  describe('comments', () => {
    it('stores mentions only for users who can see the project', async () => {
      const t = await create({ title: 'Discuss' });
      const body = `Hey <@${ctx.member.id}> and <@${ctx.outsider.id}>, thoughts? <@${ctx.member.id}>`;
      const c = await ok(app, ctx.owner, 'POST', `/tasks/${t.id}/comments`, { body });
      expect(c.mentions).toEqual([ctx.member.id]);
    });

    it('lets viewers comment, authors edit, and admins moderate', async () => {
      const t = await create({ title: 'Discuss' });
      await ok(
        app,
        ctx.owner,
        'PUT',
        `/projects/${ctx.project.id}/members/${ctx.guest.id}`,
        { role: 'viewer' },
        204,
      );
      const c = await ok(app, ctx.guest, 'POST', `/tasks/${t.id}/comments`, { body: 'First!' });

      const notAuthor = await request(app, ctx.member, 'PATCH', `/comments/${c.id}`, {
        body: 'hijack',
      });
      expect(notAuthor.statusCode).toBe(403);
      const edited = await ok(app, ctx.guest, 'PATCH', `/comments/${c.id}`, {
        body: 'First (edited)',
      });
      expect(edited.editedAt).not.toBeNull();

      expect((await request(app, ctx.member, 'DELETE', `/comments/${c.id}`)).statusCode).toBe(403);
      await ok(app, ctx.owner, 'DELETE', `/comments/${c.id}`, undefined, 204);
      expect(await ok(app, ctx.owner, 'GET', `/tasks/${t.id}/comments`)).toEqual([]);

      const types = (await ok(app, ctx.owner, 'GET', `/tasks/${t.id}/activity`)).map(
        (a: { type: string }) => a.type,
      );
      expect(types).toEqual([
        'task.created',
        'comment.created',
        'comment.updated',
        'comment.deleted',
      ]);
    });
  });

  describe('labels', () => {
    it('manages workspace labels with role checks and unique names', async () => {
      const url = `/workspaces/${ctx.workspace.id}/labels`;
      expect((await request(app, ctx.guest, 'POST', url, { name: 'x' })).statusCode).toBe(403);
      const bug = await ok(app, ctx.member, 'POST', url, { name: 'Bug', color: '#ef4444' });
      const dup = await request(app, ctx.member, 'POST', url, { name: 'bug' });
      expect(dup.json().error.code).toBe('label_exists');

      expect((await request(app, ctx.member, 'DELETE', `${url}/${bug.id}`)).statusCode).toBe(403);
      await ok(app, ctx.admin, 'DELETE', `${url}/${bug.id}`, undefined, 204);
      expect(await ok(app, ctx.guest, 'GET', url)).toEqual([]);
    });
  });

  it('deletes tasks', async () => {
    const t = await create({ title: 'Temp' });
    await ok(app, ctx.member, 'DELETE', `/tasks/${t.id}`, undefined, 204);
    expect((await request(app, ctx.owner, 'GET', `/tasks/${t.id}`)).statusCode).toBe(404);
  });
});

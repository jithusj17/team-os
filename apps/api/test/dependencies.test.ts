import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DependencyGraph, Task } from '@team-os/shared';
import { buildTestApp, ok, request, resetState, setupProject, type TestApp } from './helpers.js';

describe('task dependencies', () => {
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

  const create = (title: string, extra: Record<string, unknown> = {}, projectId = ctx.project.id) =>
    ok<Task>(app, ctx.owner, 'POST', `/projects/${projectId}/tasks`, { title, ...extra });
  const block = (blocked: Task, blocker: Task, as = ctx.owner) =>
    request(app, as, 'POST', `/tasks/${blocked.id}/dependencies`, { blockerId: blocker.id });
  const get = (t: Task) => ok<Task>(app, ctx.owner, 'GET', `/tasks/${t.id}`);
  const move = async (t: Task, status: string) => {
    const fresh = await get(t);
    return request(app, ctx.owner, 'PATCH', `/tasks/${t.id}`, {
      version: fresh.version,
      statusId: ctx.status(status).id,
    });
  };

  it('links tasks and lists both directions', async () => {
    const design = await create('Design API');
    const build = await create('Build API');
    const res = await block(build, design);
    expect(res.statusCode).toBe(201);
    expect(res.json().blockedBy.map((t: Task) => t.key)).toEqual(['ENG-1']);

    const fromBlocker = await ok(app, ctx.owner, 'GET', `/tasks/${design.id}/dependencies`);
    expect(fromBlocker.blocking[0]).toMatchObject({ key: 'ENG-2', closed: false });
    expect((await get(build)).openBlockerCount).toBe(1);
  });

  it('rejects self-links, duplicates and cycles', async () => {
    const a = await create('A');
    const b = await create('B');
    const c = await create('C');
    expect((await block(a, a)).json().error.code).toBe('self_dependency');

    expect((await block(b, a)).statusCode).toBe(201); // A blocks B
    expect((await block(b, a)).json().error.code).toBe('dependency_exists');
    expect((await block(c, b)).statusCode).toBe(201); // B blocks C

    const cycle = await block(a, c); // C blocks A would close the loop A -> B -> C -> A
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json().error.code).toBe('dependency_cycle');
  });

  it('never lets concurrent links form a cycle', async () => {
    const a = await create('A');
    const b = await create('B');
    const results = await Promise.all([block(a, b), block(b, a)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it('blocks completing a task until its blockers are closed', async () => {
    const design = await create('Design');
    const build = await create('Build');
    await block(build, design);

    const blocked = await move(build, 'Done');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('blocked_by_open_tasks');
    expect(blocked.json().error.message).toContain('ENG-1');

    // Moving to another open status or canceling is fine.
    expect((await move(build, 'In Progress')).statusCode).toBe(200);

    expect((await move(design, 'Done')).statusCode).toBe(200);
    expect((await get(build)).openBlockerCount).toBe(0);
    expect((await move(build, 'Done')).statusCode).toBe(200);
  });

  it('can turn the rule off per project', async () => {
    const design = await create('Design');
    const build = await create('Build');
    await block(build, design);
    await ok(app, ctx.owner, 'PATCH', `/projects/${ctx.project.id}`, {
      enforceDependencies: false,
    });
    expect((await move(build, 'Done')).statusCode).toBe(200);
  });

  it('removes links and records both in the activity log', async () => {
    const a = await create('A');
    const b = await create('B');
    await block(b, a);
    await ok(app, ctx.owner, 'DELETE', `/tasks/${b.id}/dependencies/${a.id}`, undefined, 204);
    const again = await request(app, ctx.owner, 'DELETE', `/tasks/${b.id}/dependencies/${a.id}`);
    expect(again.json().error.code).toBe('dependency_not_found');

    const types = (await ok(app, ctx.owner, 'GET', `/tasks/${b.id}/activity`)).map(
      (e: { type: string }) => e.type,
    );
    expect(types).toEqual(['task.created', 'dependency.added', 'dependency.removed']);
  });

  it('works across projects but hides tasks from projects the viewer cannot see', async () => {
    const ops = await app.container.projects.create.execute(ctx.owner.id, ctx.workspace.id, {
      name: 'Ops',
      key: 'OPS',
      description: '',
      visibility: 'private',
    });
    const infra = await create('Provision DB', {}, ops.id);
    const app1 = await create('Ship app');
    expect((await block(app1, infra)).statusCode).toBe(201);

    // A workspace member can see ENG but not the private OPS project.
    const asMember = await ok(app, ctx.member, 'GET', `/tasks/${app1.id}/dependencies`);
    expect(asMember).toEqual({ blockedBy: [], blocking: [], hiddenCount: 1 });
    expect(
      (await ok(app, ctx.owner, 'GET', `/tasks/${app1.id}/dependencies`)).blockedBy,
    ).toHaveLength(1);

    // ...and can't link to a task they can't see.
    const other = await create('Other');
    const hidden = await block(other, infra, ctx.member);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json().error.code).toBe('blocker_not_found');
  });

  it('requires edit rights on the blocked task', async () => {
    const a = await create('A');
    const b = await create('B');
    await ok(
      app,
      ctx.owner,
      'PUT',
      `/projects/${ctx.project.id}/members/${ctx.member.id}`,
      { role: 'viewer' },
      204,
    );
    expect((await block(b, a, ctx.member)).statusCode).toBe(403);
  });

  it('returns the dependency graph with the critical path of open work', async () => {
    //   design(3) -> api(5) -> ui(2)
    //   design(3) -> docs(1)
    //   setup(done) -> api
    const design = await create('Design', { estimate: 3 });
    const api = await create('API', { estimate: 5 });
    const ui = await create('UI', { estimate: 2 });
    const docs = await create('Docs', { estimate: 1 });
    const setup = await create('Setup', { estimate: 8 });
    await block(api, design);
    await block(ui, api);
    await block(docs, design);
    await block(api, setup);
    await move(setup, 'Done');

    const graph = await ok<DependencyGraph>(
      app,
      ctx.member,
      'GET',
      `/projects/${ctx.project.id}/dependency-graph`,
    );
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges).toHaveLength(4);
    expect(graph.criticalPath).toEqual({ taskIds: [design.id, api.id, ui.id], length: 10 });
  });
});

import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { io as connectClient } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emailJob, QUEUES, type Notification, type Task } from '@team-os/shared';
import { attachDeadLetter, startWorkers } from '../src/jobs/workers.js';
import {
  buildTestApp,
  ok,
  request,
  resetState,
  setupProject,
  testConfig,
  type TestApp,
  type TestUser,
} from './helpers.js';

const silent = pino({ level: 'silent' });

describe('notifications', () => {
  let app: TestApp;
  let ctx: Awaited<ReturnType<typeof setupProject>>;
  let processedSeq = 0;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetState(app);
    ctx = await setupProject(app);
    processedSeq = await app.container.uow.repos.events.latestSeq(ctx.workspace.id);
  });

  /** Runs fan-out for every event since the last call, as the worker would. */
  async function processEvents() {
    const events = await app.container.uow.repos.events.listSince(
      ctx.workspace.id,
      processedSeq,
      1000,
    );
    for (const e of events) await app.container.notifications.fanOut.execute(e);
    processedSeq = events.at(-1)?.seq ?? processedSeq;
  }

  const inbox = (user: TestUser, query = '') =>
    ok<{ items: Notification[]; unreadCount: number; nextCursor: string | null }>(
      app,
      user,
      'GET',
      `/me/notifications${query}`,
    );
  const types = async (user: TestUser) => (await inbox(user)).items.map((n) => n.type).sort();
  const create = (body: Record<string, unknown>, as = ctx.owner) =>
    ok<Task>(app, as, 'POST', `/projects/${ctx.project.id}/tasks`, body);
  const update = (t: Task, body: Record<string, unknown>, as = ctx.owner) =>
    ok<Task>(app, as, 'PATCH', `/tasks/${t.id}`, { version: t.version, ...body });

  it('notifies assignees, but not people assigning themselves', async () => {
    await create({ title: 'For Bob', assigneeId: ctx.member.id });
    await create({ title: 'Mine', assigneeId: ctx.owner.id });
    await processEvents();

    const [n] = (await inbox(ctx.member)).items;
    expect(n).toMatchObject({
      type: 'assigned',
      actorId: ctx.owner.id,
      data: { taskKey: 'ENG-1', taskTitle: 'For Bob' },
      readAt: null,
    });
    expect(await types(ctx.owner)).toEqual([]);
  });

  it('notifies mentioned users and other watchers about comments', async () => {
    const t = await create({ title: 'Discuss', assigneeId: ctx.admin.id }); // owner + admin watch
    await ok(app, ctx.member, 'POST', `/tasks/${t.id}/comments`, { body: `cc <@${ctx.owner.id}>` });
    await processEvents();

    expect(await types(ctx.owner)).toEqual(['mentioned']);
    expect(await types(ctx.admin)).toEqual(['assigned', 'commented']);
    expect(await types(ctx.member)).toEqual([]); // their own comment

    // Commenting made the member a watcher, so they hear about the next reply.
    await ok(app, ctx.owner, 'POST', `/tasks/${t.id}/comments`, { body: 'thanks!' });
    await processEvents();
    expect(await types(ctx.member)).toEqual(['commented']);
  });

  it('notifies watchers about status changes and dependents when a blocker is done', async () => {
    const blocker = await create({ title: 'Design' });
    const blocked = await create({ title: 'Build', assigneeId: ctx.member.id });
    await ok(app, ctx.owner, 'POST', `/tasks/${blocked.id}/dependencies`, {
      blockerId: blocker.id,
    });
    await ok(app, ctx.owner, 'PUT', `/tasks/${blocker.id}/watchers/me`, undefined, 204);
    await ok(app, ctx.admin, 'PUT', `/tasks/${blocker.id}/watchers/me`, undefined, 204);

    await update(blocker, { statusId: ctx.status('Done').id });
    await processEvents();

    const adminInbox = await inbox(ctx.admin);
    expect(adminInbox.items[0]).toMatchObject({
      type: 'status_changed',
      data: { statusName: 'Done' },
    });
    const memberInbox = await inbox(ctx.member);
    expect(memberInbox.items.map((n) => n.type)).toContain('blocker_resolved');
    expect(memberInbox.items.find((n) => n.type === 'blocker_resolved')!.data).toMatchObject({
      taskKey: 'ENG-2',
      blockerKey: 'ENG-1',
    });
  });

  it('is idempotent when an event is processed twice', async () => {
    await create({ title: 'Once', assigneeId: ctx.member.id });
    const [e] = await app.container.uow.repos.events.listSince(ctx.workspace.id, processedSeq, 10);
    await app.container.notifications.fanOut.execute(e!);
    await app.container.notifications.fanOut.execute(e!);
    expect((await inbox(ctx.member)).items).toHaveLength(1);
  });

  it('skips users who lost access and types users muted', async () => {
    const t = await create({ title: 'Private soon' });
    await ok(app, ctx.member, 'PUT', `/tasks/${t.id}/watchers/me`, undefined, 204);
    await ok(app, ctx.admin, 'PUT', `/tasks/${t.id}/watchers/me`, undefined, 204);
    await ok(app, ctx.admin, 'PUT', '/me/notification-preferences', {
      mutedTypes: ['commented'],
      emailDigest: true,
    });
    await ok(app, ctx.owner, 'PATCH', `/projects/${ctx.project.id}`, { visibility: 'private' });

    await ok(app, ctx.owner, 'POST', `/tasks/${t.id}/comments`, { body: 'only admins now' });
    await processEvents();
    expect(await types(ctx.member)).toEqual([]); // can't see the private project
    expect(await types(ctx.admin)).toEqual([]); // muted
  });

  it('pages the inbox and marks notifications read', async () => {
    for (let i = 0; i < 5; i++) await create({ title: `T${i}`, assigneeId: ctx.member.id });
    await processEvents();

    const first = await inbox(ctx.member, '?limit=2');
    expect(first.unreadCount).toBe(5);
    const second = await inbox(ctx.member, `?limit=10&cursor=${first.nextCursor}`);
    expect([...first.items, ...second.items].map((n) => n.id)).toHaveLength(5);

    const marked = await ok(
      app,
      ctx.member,
      'POST',
      '/me/notifications/read',
      { ids: [first.items[0]!.id] },
      200,
    );
    expect(marked).toEqual({ updated: 1, unreadCount: 4 });
    // Someone else's ids are ignored rather than marked.
    expect(
      await ok(
        app,
        ctx.owner,
        'POST',
        '/me/notifications/read',
        { ids: [first.items[1]!.id] },
        200,
      ),
    ).toEqual({
      updated: 0,
      unreadCount: 0,
    });
    await ok(app, ctx.member, 'POST', '/me/notifications/read', { all: true }, 200);
    expect((await inbox(ctx.member, '?unread=true')).items).toEqual([]);
  });

  it('validates preferences', async () => {
    expect(await ok(app, ctx.member, 'GET', '/me/notification-preferences')).toEqual({
      mutedTypes: [],
      emailDigest: true,
    });
    const bad = await request(app, ctx.member, 'PUT', '/me/notification-preferences', {
      mutedTypes: ['nope'],
      emailDigest: true,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('sends one due-soon reminder per task and due date', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await create({ title: 'Due today', assigneeId: ctx.member.id, dueDate: today });
    await create({ title: 'Due later', assigneeId: ctx.member.id, dueDate: '2099-01-01' });
    await create({ title: 'Unassigned', dueDate: today });

    const reminders = app.container.notifications.sendDueSoonReminders;
    expect(await reminders.execute()).toHaveLength(1);
    expect(await reminders.execute()).toHaveLength(0);
    const n = (await inbox(ctx.member)).items.find((x) => x.type === 'due_soon');
    expect(n?.data).toMatchObject({ taskTitle: 'Due today', dueDate: today });
  });

  it('emails a daily digest of unread notifications once', async () => {
    await create({ title: 'A', assigneeId: ctx.member.id });
    await create({ title: 'B', assigneeId: ctx.admin.id });
    await ok(app, ctx.admin, 'PUT', '/me/notification-preferences', {
      mutedTypes: [],
      emailDigest: false,
    });
    await processEvents();

    const digests = app.container.notifications.sendEmailDigests;
    expect(await digests.execute()).toBe(1); // admin opted out
    expect(await digests.execute()).toBe(0); // already emailed

    const jobs = await app.container.jobs.queue(QUEUES.email).getJobs(['waiting']);
    const digest = jobs
      .map((j) => emailJob.parse(j.data))
      .find((j) => j.type === 'notification-digest');
    expect(digest).toMatchObject({
      to: 'member@example.com',
      items: [{ text: 'Olivia Owner assigned you ENG-1: A' }],
    });
  });

  it('pushes new notifications to the user’s open connections', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const socket = connectClient(`http://127.0.0.1:${port}`, {
      path: '/socket.io',
      transports: ['websocket'],
      extraHeaders: { cookie: ctx.member.cookie },
    });
    try {
      await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
      const pushed = new Promise<Notification>((resolve) => socket.once('notification', resolve));
      await create({ title: 'Ping', assigneeId: ctx.member.id });
      await processEvents();
      expect((await pushed).data.taskTitle).toBe('Ping');
    } finally {
      socket.disconnect();
    }
  });

  describe('background workers', () => {
    it('processes domain events end to end through BullMQ', async () => {
      const connection = new Redis(testConfig().REDIS_URL, { maxRetriesPerRequest: null });
      const workers = await startWorkers({ container: app.container, connection, log: silent });
      try {
        const t = await create({ title: 'Via queue', assigneeId: ctx.member.id });
        const [e] = await app.container.uow.repos.events.listSince(
          ctx.workspace.id,
          processedSeq,
          10,
        );
        await app.container.jobs.queue(QUEUES.domainEvents).add(e!.type, e);
        await expect
          .poll(async () => (await inbox(ctx.member)).items.map((n) => n.taskId), { timeout: 5000 })
          .toEqual([t.id]);
      } finally {
        await workers.close();
        await connection.quit();
      }
    });

    it('retries failing jobs and dead-letters them after the last attempt', async () => {
      const connection = new Redis(testConfig().REDIS_URL, { maxRetriesPerRequest: null });
      const queue = new Queue('test-flaky', { connection });
      const deadLetter = new Queue(QUEUES.deadLetter, { connection });
      let calls = 0;
      const worker = new Worker(
        'test-flaky',
        async (): Promise<void> => {
          calls++;
          throw new Error('provider down');
        },
        { connection },
      );
      attachDeadLetter(worker, deadLetter, silent);
      try {
        await queue.add(
          'send',
          { to: 'x' },
          { attempts: 3, backoff: { type: 'fixed', delay: 20 } },
        );
        await expect
          .poll(() => deadLetter.getJobCounts('waiting').then((c) => c.waiting), { timeout: 5000 })
          .toBe(1);
        expect(calls).toBe(3);
        const [dead] = await deadLetter.getJobs(['waiting']);
        expect(dead!.data).toMatchObject({
          queue: 'test-flaky',
          failedReason: 'provider down',
          attemptsMade: 3,
          data: { to: 'x' },
        });
      } finally {
        await worker.close();
        await Promise.all([queue.close(), deadLetter.close()]);
        await connection.quit();
      }
    });
  });
});

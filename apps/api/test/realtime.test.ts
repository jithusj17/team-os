import { Redis } from 'ioredis';
import { pino } from 'pino';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ClientToServerEvents,
  EventsResponse,
  PresenceUpdate,
  ServerToClientEvents,
  SocketAck,
  Task,
  WorkspaceEvent,
} from '@team-os/shared';
import { OutboxRelay } from '../src/infrastructure/outbox/outbox-relay.js';
import { SocketIoEventPublisher } from '../src/modules/realtime/infrastructure/socket-io-event-publisher.js';
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

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const silent = pino({ level: 'silent' });

describe('real-time', () => {
  // Two API instances behind "a load balancer", plus the relay that the worker would run.
  let api1: TestApp;
  let api2: TestApp;
  let port1: number;
  let emitterRedis: Redis;
  let relay: OutboxRelay;
  let ctx: Awaited<ReturnType<typeof setupProject>>;
  const clients: Client[] = [];

  beforeAll(async () => {
    api1 = await buildTestApp();
    api2 = await buildTestApp();
    await api1.listen({ port: 0, host: '127.0.0.1' });
    await api2.listen({ port: 0, host: '127.0.0.1' });
    port1 = (api1.server.address() as { port: number }).port;
    emitterRedis = new Redis(testConfig().REDIS_URL);
    relay = new OutboxRelay(api1.sql, new SocketIoEventPublisher(emitterRedis), silent);
  });

  afterAll(async () => {
    await relay.stop();
    await emitterRedis.quit();
    await Promise.all([api1.close(), api2.close()]);
  });

  beforeEach(async () => {
    await resetState(api1);
    ctx = await setupProject(api1);
  });

  afterEach(() => {
    for (const c of clients.splice(0)) c.disconnect();
  });

  function connect(user: TestUser | null): Promise<Client> {
    const socket: Client = connectClient(`http://127.0.0.1:${port1}`, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: user ? { cookie: user.cookie } : {},
    });
    clients.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  const ack = (socket: Client, event: 'subscribe' | 'presence:enter', msg: object) =>
    new Promise<SocketAck>((resolve) =>
      (socket.emit as (e: string, m: object, cb: (r: SocketAck) => void) => void)(
        event,
        msg,
        resolve,
      ),
    );

  function next<T>(
    socket: Client,
    event: 'event' | 'presence',
    match: (v: T) => boolean = () => true,
  ) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 3000);
      const handler = (value: T) => {
        if (!match(value)) return;
        clearTimeout(timer);
        socket.off(event, handler as never);
        resolve(value);
      };
      socket.on(event, handler as never);
    });
  }

  const createTask = (title: string, via = api2) =>
    ok<Task>(via, ctx.owner, 'POST', `/projects/${ctx.project.id}/tasks`, { title });

  it('rejects connections without a valid session', async () => {
    await expect(connect(null)).rejects.toThrow('unauthorized');
    await expect(connect({ ...ctx.member, cookie: 'sid=forged' })).rejects.toThrow('unauthorized');
  });

  it('only lets users join rooms they can access', async () => {
    const member = await connect(ctx.member);
    expect(await ack(member, 'subscribe', { projectId: ctx.project.id })).toMatchObject({
      ok: true,
      room: `project:${ctx.project.id}`,
    });

    const guest = await connect(ctx.guest);
    expect(await ack(guest, 'subscribe', { projectId: ctx.project.id })).toEqual({
      ok: false,
      error: { code: 'project_not_found', message: 'Project not found' },
    });
    const outsider = await connect(ctx.outsider);
    expect(await ack(outsider, 'subscribe', { workspaceId: ctx.workspace.id })).toMatchObject({
      ok: false,
    });
    expect(await ack(outsider, 'subscribe', { projectId: 'not-a-uuid' })).toMatchObject({
      ok: false,
      error: { code: 'validation_error' },
    });
  });

  it('delivers changes made on another instance, in order', async () => {
    const member = await connect(ctx.member);
    const sub = await ack(member, 'subscribe', { projectId: ctx.project.id });
    const startSeq = sub.ok ? sub.latestSeq! : -1;

    const created = next<WorkspaceEvent>(member, 'event', (e) => e.type === 'task.created');
    const task = await createTask('Realtime!');
    await relay.drain();
    const event = await created;
    expect(event).toMatchObject({
      type: 'task.created',
      projectId: ctx.project.id,
      taskId: task.id,
      actorId: ctx.owner.id,
      seq: startSeq + 1,
    });
    expect((event.payload as Task).key).toBe('ENG-1');

    const updated = next<WorkspaceEvent>(member, 'event', (e) => e.type === 'task.updated');
    await ok(api2, ctx.owner, 'PATCH', `/tasks/${task.id}`, { version: 1, title: 'Renamed' });
    await relay.drain();
    expect(((await updated).payload as Task).title).toBe('Renamed');
  });

  it('publishes automatically once the relay is running', async () => {
    await relay.start();
    try {
      const member = await connect(ctx.member);
      await ack(member, 'subscribe', { projectId: ctx.project.id });
      const received = next<WorkspaceEvent>(member, 'event', (e) => e.type === 'task.created');
      await createTask('Pushed by NOTIFY');
      expect((await received).type).toBe('task.created');
    } finally {
      await relay.stop();
      relay = new OutboxRelay(api1.sql, new SocketIoEventPublisher(emitterRedis), silent);
    }
  });

  it('elects a single relay leader and fails over', async () => {
    const publisher = new SocketIoEventPublisher(emitterRedis);
    const a = new OutboxRelay(api1.sql, publisher, silent, { pollMs: 50 });
    const b = new OutboxRelay(api2.sql, publisher, silent, { pollMs: 50 });
    try {
      await a.start();
      await b.start();
      expect([a.isLeader, b.isLeader]).toEqual([true, false]);
      await a.stop();
      await expect.poll(() => b.isLeader, { timeout: 2000 }).toBe(true);
    } finally {
      await Promise.all([a.stop(), b.stop()]);
    }
  });

  describe('catch-up endpoint', () => {
    const events = (user: TestUser, after: number, limit = 500) =>
      ok<EventsResponse>(
        api1,
        user,
        'GET',
        `/workspaces/${ctx.workspace.id}/events?after=${after}&limit=${limit}`,
      );

    it('records exactly one event per committed change, and none for failed ones', async () => {
      const before = (await events(ctx.owner, 0)).latestSeq;
      const task = await createTask('A');
      const stale = await request(api1, ctx.owner, 'PATCH', `/tasks/${task.id}`, {
        version: 99,
        title: 'x',
      });
      expect(stale.statusCode).toBe(409);

      const res = await events(ctx.owner, before);
      expect(res.events.map((e) => [e.seq, e.type])).toEqual([[before + 1, 'task.created']]);
      expect(res.latestSeq).toBe(before + 1);
    });

    it('hides events from projects the user cannot see', async () => {
      const secret = await ok(api1, ctx.owner, 'POST', `/workspaces/${ctx.workspace.id}/projects`, {
        name: 'Secret',
        key: 'SEC',
        visibility: 'private',
      });
      await ok(api1, ctx.owner, 'POST', `/projects/${secret.id}/tasks`, { title: 'Hidden' });
      await createTask('Visible');

      const types = (u: TestUser) => events(u, 0).then((r) => r.events.map((e) => e.type));
      expect(await types(ctx.owner)).toContain('project.created');
      const memberSees = (await events(ctx.member, 0)).events;
      expect(memberSees.some((e) => e.projectId === secret.id)).toBe(false);
      expect(memberSees.some((e) => e.type === 'task.created')).toBe(true);
    });

    it('pages through history and flags when a full resync is needed', async () => {
      for (let i = 0; i < 5; i++) await createTask(`T${i}`);
      const first = await events(ctx.owner, 0, 2);
      expect(first.hasMore).toBe(true);
      const second = await events(ctx.owner, first.latestSeq, 100);
      expect(second.events[0]!.seq).toBe(first.latestSeq + 1);
      expect(second.hasMore).toBe(false);

      expect((await events(ctx.owner, 10_000)).resyncRequired).toBe(true);
      await api1.sql`delete from events where seq <= 3`;
      expect((await events(ctx.owner, 1)).resyncRequired).toBe(true);
      expect((await events(ctx.owner, 3)).resyncRequired).toBe(false);
    });
  });

  it('shares presence across users and clears it on disconnect', async () => {
    const task = await createTask('Look at me');
    const owner = await connect(ctx.owner);
    const member = await connect(ctx.member);
    const target = { taskId: task.id };

    expect(await ack(owner, 'presence:enter', target)).toMatchObject({ ok: true });
    const both = next<PresenceUpdate>(owner, 'presence', (p) => p.userIds.length === 2);
    await ack(member, 'presence:enter', target);
    expect((await both).userIds).toEqual([ctx.owner.id, ctx.member.id].sort());

    const one = next<PresenceUpdate>(owner, 'presence', (p) => p.userIds.length === 1);
    member.disconnect();
    expect((await one).userIds).toEqual([ctx.owner.id]);

    const outsider = await connect(ctx.outsider);
    expect(await ack(outsider, 'presence:enter', target)).toMatchObject({ ok: false });
  });

  it('disconnects users whose access was revoked', async () => {
    const member = await connect(ctx.member);
    await ack(member, 'subscribe', { projectId: ctx.project.id });
    const kicked = new Promise<string>((resolve) => member.once('disconnect', resolve));

    await ok(
      api2,
      ctx.owner,
      'DELETE',
      `/workspaces/${ctx.workspace.id}/members/${ctx.member.id}`,
      undefined,
      204,
    );
    await relay.drain();
    expect(await kicked).toBe('io server disconnect');

    // Reconnecting works, but the project room is now off-limits.
    const again = await connect(ctx.member);
    expect(await ack(again, 'subscribe', { projectId: ctx.project.id })).toMatchObject({
      ok: false,
    });
  });

  it('closes only the signed-out session’s sockets on logout', async () => {
    const otherDevice = await api1.container.identity.devSignIn.execute({
      email: ctx.member.email,
    });
    const laptop = await connect(ctx.member);
    const phone = await connect({ ...ctx.member, cookie: `sid=${otherDevice.sessionToken}` });
    const laptopClosed = new Promise<string>((resolve) => laptop.once('disconnect', resolve));

    await ok(api2, ctx.member, 'POST', '/auth/logout', undefined, 204);
    expect(await laptopClosed).toBe('io server disconnect');
    expect(phone.connected).toBe(true);
  });
});

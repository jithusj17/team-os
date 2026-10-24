import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Doc, Meeting, Task } from '@team-os/shared';
import { buildTestApp, ok, request, resetState, setupProject, type TestApp } from './helpers.js';

describe('docs and meetings', () => {
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

  const ws = () => `/workspaces/${ctx.workspace.id}`;
  const task = (title: string) =>
    ok<Task>(app, ctx.owner, 'POST', `/projects/${ctx.project.id}/tasks`, { title });

  describe('docs', () => {
    it('creates workspace docs for members but not guests', async () => {
      const d = await ok<Doc>(app, ctx.member, 'POST', `${ws()}/docs`, {
        title: 'Handbook',
        body: '# Hi',
      });
      expect(d).toMatchObject({ title: 'Handbook', projectId: null, version: 1, canEdit: true });

      expect(
        (await request(app, ctx.guest, 'POST', `${ws()}/docs`, { title: 'x' })).statusCode,
      ).toBe(403);
      expect((await request(app, ctx.guest, 'GET', `/docs/${d.id}`)).statusCode).toBe(404);
      expect(await ok(app, ctx.guest, 'GET', `${ws()}/docs`)).toEqual([]);
      expect((await request(app, ctx.outsider, 'GET', `/docs/${d.id}`)).statusCode).toBe(404);
    });

    it('applies project roles to project docs', async () => {
      const d = await ok<Doc>(app, ctx.owner, 'POST', `${ws()}/docs`, {
        title: 'Spec',
        projectId: ctx.project.id,
      });
      await ok(
        app,
        ctx.owner,
        'PUT',
        `/projects/${ctx.project.id}/members/${ctx.guest.id}`,
        { role: 'viewer' },
        204,
      );

      const asGuest = await ok<Doc>(app, ctx.guest, 'GET', `/docs/${d.id}`);
      expect(asGuest).toMatchObject({ canEdit: false, canDelete: false });
      expect(
        (await request(app, ctx.guest, 'PATCH', `/docs/${d.id}`, { version: 1, body: 'x' }))
          .statusCode,
      ).toBe(403);

      // Members are editors of workspace projects: they can edit, but only delete their own docs.
      await ok(app, ctx.member, 'PATCH', `/docs/${d.id}`, { version: 1, body: 'edited' });
      expect((await request(app, ctx.member, 'DELETE', `/docs/${d.id}`)).statusCode).toBe(403);
      const listed = await ok<Doc[]>(
        app,
        ctx.guest,
        'GET',
        `${ws()}/docs?projectId=${ctx.project.id}`,
      );
      expect(listed.map((x) => x.title)).toEqual(['Spec']);
    });

    it('rejects stale edits and keeps one history entry per editing session', async () => {
      const d = await ok<Doc>(app, ctx.owner, 'POST', `${ws()}/docs`, {
        title: 'Notes',
        body: 'v1',
      });
      const v2 = await ok<Doc>(app, ctx.owner, 'PATCH', `/docs/${d.id}`, {
        version: 1,
        body: 'v2',
      });
      await ok(app, ctx.owner, 'PATCH', `/docs/${d.id}`, { version: v2.version, body: 'v3' });

      const stale = await request(app, ctx.member, 'PATCH', `/docs/${d.id}`, {
        version: 1,
        body: 'lost?',
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('version_conflict');

      // Same author within minutes: their edits fold into one entry; another author starts one.
      await ok(app, ctx.member, 'PATCH', `/docs/${d.id}`, { version: 3, body: 'member edit' });
      const versions = await ok<{ id: string; version: number; authorId: string }[]>(
        app,
        ctx.owner,
        'GET',
        `/docs/${d.id}/versions`,
      );
      expect(versions.map((v) => [v.version, v.authorId])).toEqual([
        [4, ctx.member.id],
        [3, ctx.owner.id],
      ]);
      const old = await ok(app, ctx.owner, 'GET', `/docs/${d.id}/versions/${versions[1]!.id}`);
      expect(old.body).toBe('v3');
    });

    it('links tasks and hides ones the viewer cannot see', async () => {
      const t = await task('Implement spec');
      const d = await ok<Doc>(app, ctx.owner, 'POST', `${ws()}/docs`, { title: 'Spec' });
      const linked = await ok<Doc>(
        app,
        ctx.owner,
        'POST',
        `/docs/${d.id}/tasks`,
        { taskId: t.id },
        200,
      );
      expect(linked.linkedTasks).toEqual([
        { id: t.id, key: 'ENG-1', title: 'Implement spec', projectId: ctx.project.id },
      ]);

      await ok(app, ctx.owner, 'PATCH', `/projects/${ctx.project.id}`, { visibility: 'private' });
      expect((await ok<Doc>(app, ctx.member, 'GET', `/docs/${d.id}`)).linkedTasks).toEqual([]);

      await ok(app, ctx.owner, 'DELETE', `/docs/${d.id}/tasks/${t.id}`, undefined, 200);
      expect((await ok<Doc>(app, ctx.owner, 'GET', `/docs/${d.id}`)).linkedTasks).toEqual([]);
    });
  });

  describe('meetings', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 2, h)).toISOString();
    const create = (body: Record<string, unknown>, as = ctx.owner) =>
      ok<Meeting>(app, as, 'POST', `${ws()}/meetings`, {
        title: 'Planning',
        startsAt: at(9),
        endsAt: at(10),
        ...body,
      });
    const list = (as = ctx.owner, extra = '') =>
      ok<Meeting[]>(app, as, 'GET', `${ws()}/meetings?from=${at(0)}&to=${at(23)}${extra}`);

    it('creates a meeting with the organizer attending and validates times', async () => {
      const m = await create({ attendeeIds: [ctx.member.id] });
      expect(m.attendees).toEqual(
        expect.arrayContaining([
          { userId: ctx.owner.id, response: 'accepted' },
          { userId: ctx.member.id, response: 'pending' },
        ]),
      );
      const backwards = await request(app, ctx.owner, 'POST', `${ws()}/meetings`, {
        title: 'x',
        startsAt: at(10),
        endsAt: at(9),
      });
      expect(backwards.statusCode).toBe(400);
    });

    it('shows workspace meetings to members, and to guests only when invited', async () => {
      const m = await create({});
      expect((await list(ctx.member)).map((x) => x.id)).toEqual([m.id]);
      expect(await list(ctx.guest)).toEqual([]);

      await ok(app, ctx.owner, 'PATCH', `/meetings/${m.id}`, {
        version: m.version,
        attendeeIds: [ctx.guest.id],
      });
      expect((await list(ctx.guest)).map((x) => x.id)).toEqual([m.id]);
      expect(await list(ctx.member, '&mine=true')).toEqual([]);
    });

    it('lets only organizers and admins edit, and attendees RSVP', async () => {
      const m = await create({ attendeeIds: [ctx.member.id] });
      expect(
        (await request(app, ctx.member, 'PATCH', `/meetings/${m.id}`, { version: 1, title: 'x' }))
          .statusCode,
      ).toBe(403);
      await ok(app, ctx.admin, 'PATCH', `/meetings/${m.id}`, {
        version: 1,
        title: 'Sprint planning',
      });

      const rsvp = await ok<Meeting>(app, ctx.member, 'PUT', `/meetings/${m.id}/rsvp`, {
        response: 'declined',
      });
      expect(rsvp.attendees.find((a) => a.userId === ctx.member.id)?.response).toBe('declined');
      expect(
        (await request(app, ctx.admin, 'PUT', `/meetings/${m.id}/rsvp`, { response: 'accepted' }))
          .statusCode,
      ).toBe(403);
    });

    it('rejects attendees who cannot see a project meeting', async () => {
      const res = await request(app, ctx.owner, 'POST', `${ws()}/meetings`, {
        title: 'ENG sync',
        startsAt: at(9),
        endsAt: at(10),
        projectId: ctx.project.id,
        attendeeIds: [ctx.guest.id],
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_attendee');
    });

    it('creates notes once, linked to the meeting tasks, readable by attendees', async () => {
      const t = await task('Follow-up');
      const m = await create({ attendeeIds: [ctx.guest.id] });
      await ok(app, ctx.owner, 'POST', `/meetings/${m.id}/tasks`, { taskId: t.id }, 200);

      const { docId } = await ok(app, ctx.guest, 'POST', `/meetings/${m.id}/notes`, undefined, 200);
      const again = await ok(app, ctx.owner, 'POST', `/meetings/${m.id}/notes`, undefined, 200);
      expect(again.docId).toBe(docId);

      const notes = await ok<Doc>(app, ctx.owner, 'GET', `/docs/${docId}`);
      expect(notes.title).toBe('Notes: Planning (Nov 2, 2026)');
      expect(notes.body).toContain('## Action items');
      expect(notes.linkedTasks.map((x) => x.id)).toEqual([t.id]);
      expect((await ok<Meeting>(app, ctx.owner, 'GET', `/meetings/${m.id}`)).notesDocId).toBe(
        docId,
      );
    });

    it('records events for real-time clients', async () => {
      const before = await app.container.uow.repos.events.latestSeq(ctx.workspace.id);
      const m = await create({});
      await ok(app, ctx.owner, 'DELETE', `/meetings/${m.id}`, undefined, 204);
      const events = await app.container.uow.repos.events.listSince(ctx.workspace.id, before, 10);
      expect(events.map((e) => e.type)).toEqual(['meeting.created', 'meeting.deleted']);
    });
  });
});

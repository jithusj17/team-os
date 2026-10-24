import { describe, expect, it } from 'vitest';
import { canOnDoc, canOnMeeting } from '@team-os/shared';
import { SNAPSHOT_SESSION_MS, startsNewSnapshot } from '../../src/modules/docs/domain/doc.js';
import { notesTemplate } from '../../src/modules/meetings/domain/meeting.js';

describe('startsNewSnapshot', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it('folds quick edits by the same author into one history entry', () => {
    expect(startsNewSnapshot(null, 'a', now)).toBe(true);
    expect(startsNewSnapshot({ authorId: 'a', createdAt: ago(60_000) }, 'a', now)).toBe(false);
    expect(startsNewSnapshot({ authorId: 'b', createdAt: ago(60_000) }, 'a', now)).toBe(true);
    expect(
      startsNewSnapshot({ authorId: 'a', createdAt: ago(SNAPSHOT_SESSION_MS + 1) }, 'a', now),
    ).toBe(true);
  });
});

describe('canOnDoc', () => {
  const ws = {
    workspaceRole: 'member',
    isProjectDoc: false,
    projectRole: null,
    isCreator: false,
  } as const;
  it('keeps guests out of workspace docs and limits deletes to admins and creators', () => {
    expect(canOnDoc({ ...ws, workspaceRole: 'guest' }, 'read')).toBe(false);
    expect(canOnDoc(ws, 'edit')).toBe(true);
    expect(canOnDoc(ws, 'delete')).toBe(false);
    expect(canOnDoc({ ...ws, isCreator: true }, 'delete')).toBe(true);
    expect(canOnDoc({ ...ws, workspaceRole: 'admin' }, 'delete')).toBe(true);
  });
  it('follows project roles for project docs', () => {
    const p = { ...ws, isProjectDoc: true } as const;
    expect(canOnDoc(p, 'read')).toBe(false);
    expect(canOnDoc({ ...p, projectRole: 'viewer' }, 'edit')).toBe(false);
    expect(canOnDoc({ ...p, projectRole: 'editor' }, 'edit')).toBe(true);
    expect(canOnDoc({ ...p, projectRole: 'editor' }, 'delete')).toBe(false);
    expect(canOnDoc({ ...p, projectRole: 'admin' }, 'delete')).toBe(true);
  });
});

describe('canOnMeeting', () => {
  const base = {
    workspaceRole: 'guest',
    isProjectMeeting: false,
    projectRole: null,
    isOrganizer: false,
    isAttendee: false,
  } as const;
  it('lets attendees see and answer, and organizers/admins edit', () => {
    expect(canOnMeeting(base, 'read')).toBe(false);
    expect(canOnMeeting({ ...base, isAttendee: true }, 'read')).toBe(true);
    expect(canOnMeeting({ ...base, isAttendee: true }, 'rsvp')).toBe(true);
    expect(canOnMeeting({ ...base, isAttendee: true }, 'edit')).toBe(false);
    expect(canOnMeeting({ ...base, workspaceRole: 'member' }, 'read')).toBe(true);
    expect(canOnMeeting({ ...base, workspaceRole: 'admin' }, 'edit')).toBe(true);
    expect(canOnMeeting({ ...base, isProjectMeeting: true, workspaceRole: 'member' }, 'read')).toBe(
      false,
    );
    expect(canOnMeeting({ ...base, isProjectMeeting: true, projectRole: 'admin' }, 'edit')).toBe(
      true,
    );
  });
});

describe('notesTemplate', () => {
  it('includes the description only when there is one', () => {
    expect(notesTemplate({ title: 'Sync', description: '' })).toMatch(/^# Sync\n\n## Agenda/);
    expect(notesTemplate({ title: 'Sync', description: 'Weekly' })).toMatch(
      /^# Sync\n\nWeekly\n\n## Agenda/,
    );
  });
});

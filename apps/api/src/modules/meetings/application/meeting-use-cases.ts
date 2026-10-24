import { canOnMeeting, type MeetingAction, type RsvpResponse } from '@team-os/shared';
import type { EventRepository } from '../../../shared/application/events.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { conflict, forbidden, notFound, validation } from '../../../shared/domain/errors.js';
import type { DocRepository } from '../../docs/domain/ports.js';
import type { ProjectAccess } from '../../projects/application/project-access.js';
import type { TaskRepository } from '../../tasks/domain/ports.js';
import type { WorkspaceAccess } from '../../workspaces/application/workspace-access.js';
import type { MemberRepository } from '../../workspaces/domain/ports.js';
import { notesTemplate, notesTitle, type Attendee, type Meeting } from '../domain/meeting.js';
import type { MeetingRepository } from '../domain/ports.js';

type Repos = {
  meetings: MeetingRepository;
  members: MemberRepository;
  tasks: TaskRepository;
  docs: DocRepository;
  events: EventRepository;
};
type Deps = {
  uow: UnitOfWork<Repos>;
  projectAccess: ProjectAccess;
  workspaceAccess: WorkspaceAccess;
};

const meetingNotFound = () => notFound('meeting_not_found', 'Meeting not found');

async function permissions(deps: Deps, actorId: string, m: Meeting, attendees: Attendee[]) {
  const workspaceRole = await deps.uow.repos.members.findRole(m.workspaceId, actorId);
  if (!workspaceRole) return null;
  const projectRole = m.projectId
    ? ((await deps.projectAccess.grantFor(actorId, m.projectId))?.role ?? null)
    : null;
  const ctx = {
    workspaceRole,
    isProjectMeeting: m.projectId !== null,
    projectRole,
    isOrganizer: m.organizerId === actorId,
    isAttendee: attendees.some((a) => a.userId === actorId),
  };
  return (action: MeetingAction) => canOnMeeting(ctx, action);
}

async function authorize(deps: Deps, actorId: string, meetingId: string, action: MeetingAction) {
  const meeting = await deps.uow.repos.meetings.findById(meetingId);
  if (!meeting) throw meetingNotFound();
  const attendees = (await deps.uow.repos.meetings.attendees([meeting.id])).get(meeting.id) ?? [];
  const can = await permissions(deps, actorId, meeting, attendees);
  if (!can?.('read')) throw meetingNotFound();
  if (!can(action)) throw forbidden();
  return { meeting, attendees, can };
}

async function view(
  deps: Deps,
  actorId: string,
  m: Meeting,
  attendees: Attendee[],
  canEdit: boolean,
) {
  const refs = await deps.uow.repos.tasks.findRefs(
    await deps.uow.repos.meetings.linkedTaskIds(m.id),
  );
  return {
    ...m,
    attendees,
    linkedTasks: await deps.projectAccess.filterVisible(actorId, refs),
    canEdit,
  };
}

/**
 * Attendees must be in the workspace and, for project meetings, able to see the project
 * (otherwise they'd be invited to something they can't open).
 */
async function validateAttendees(
  deps: Deps,
  workspaceId: string,
  projectId: string | null,
  userIds: string[],
) {
  for (const userId of new Set(userIds)) {
    const ok = projectId
      ? (await deps.projectAccess.grantFor(userId, projectId)) !== null
      : (await deps.uow.repos.members.findRole(workspaceId, userId)) !== null;
    if (!ok)
      throw validation(
        'invalid_attendee',
        'Every attendee must have access to the meeting’s project or workspace',
      );
  }
}

const meetingEvent = (
  type: 'meeting.created' | 'meeting.updated' | 'meeting.deleted',
  m: Meeting,
  actorId: string,
) => ({
  workspaceId: m.workspaceId,
  projectId: m.projectId,
  type,
  actorId,
  payload: { id: m.id },
});

export class ListMeetings {
  constructor(private readonly deps: Deps) {}

  /** Meetings in a time range that the actor can see, optionally only their own. */
  async execute(
    actorId: string,
    workspaceId: string,
    q: { from: string; to: string; mine?: boolean },
  ) {
    await this.deps.workspaceAccess.authorize(actorId, workspaceId, { action: 'workspace:read' });
    const { meetings } = this.deps.uow.repos;
    const list = await meetings.listBetween(workspaceId, new Date(q.from), new Date(q.to));
    const attendees = await meetings.attendees(list.map((m) => m.id));

    const result = [];
    for (const m of list) {
      const people = attendees.get(m.id) ?? [];
      const can = await permissions(this.deps, actorId, m, people);
      if (!can?.('read')) continue;
      if (q.mine && m.organizerId !== actorId && !people.some((a) => a.userId === actorId))
        continue;
      result.push({ ...m, attendees: people, linkedTasks: [], canEdit: can('edit') });
    }
    return result;
  }
}

export class CreateMeeting {
  constructor(private readonly deps: Deps) {}

  async execute(
    actorId: string,
    workspaceId: string,
    input: {
      title: string;
      description: string;
      location: string;
      startsAt: string;
      endsAt: string;
      attendeeIds: string[];
      projectId: string | null;
    },
  ) {
    if (input.projectId) {
      const { project } = await this.deps.projectAccess.authorize(
        actorId,
        input.projectId,
        'task:create',
      );
      if (project.workspaceId !== workspaceId)
        throw notFound('project_not_found', 'Project not found');
    } else {
      await this.deps.workspaceAccess.authorize(actorId, workspaceId, { action: 'project:create' });
    }
    await validateAttendees(this.deps, workspaceId, input.projectId, input.attendeeIds);

    const { attendeeIds, ...fields } = input;
    const meeting = await this.deps.uow.transaction(async ({ meetings, events }) => {
      const created = await meetings.create({
        ...fields,
        workspaceId,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        organizerId: actorId,
      });
      // The organizer always attends.
      await meetings.setAttendees(created.id, [actorId, ...attendeeIds]);
      await meetings.respond(created.id, actorId, 'accepted');
      await events.append(meetingEvent('meeting.created', created, actorId));
      return created;
    });
    const attendees =
      (await this.deps.uow.repos.meetings.attendees([meeting.id])).get(meeting.id) ?? [];
    return view(this.deps, actorId, meeting, attendees, true);
  }
}

export class GetMeeting {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, meetingId: string) {
    const { meeting, attendees, can } = await authorize(this.deps, actorId, meetingId, 'read');
    return view(this.deps, actorId, meeting, attendees, can('edit'));
  }
}

export class UpdateMeeting {
  constructor(private readonly deps: Deps) {}

  async execute(
    actorId: string,
    meetingId: string,
    input: {
      version: number;
      title?: string;
      description?: string;
      location?: string;
      startsAt?: string;
      endsAt?: string;
      attendeeIds?: string[];
    },
  ) {
    const { meeting } = await authorize(this.deps, actorId, meetingId, 'edit');
    const startsAt = input.startsAt ? new Date(input.startsAt) : meeting.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : meeting.endsAt;
    if (endsAt <= startsAt)
      throw validation('invalid_time', 'The meeting must end after it starts');
    if (input.attendeeIds) {
      await validateAttendees(this.deps, meeting.workspaceId, meeting.projectId, input.attendeeIds);
    }

    const { version, attendeeIds, startsAt: _s, endsAt: _e, ...fields } = input;
    const updated = await this.deps.uow.transaction(async ({ meetings, events }) => {
      const next = await meetings.updateIfVersion(meetingId, version, {
        ...fields,
        startsAt,
        endsAt,
      });
      if (!next)
        throw conflict(
          'version_conflict',
          'This meeting was changed by someone else. Reload and try again.',
        );
      if (attendeeIds) {
        await meetings.setAttendees(meetingId, [
          ...(meeting.organizerId ? [meeting.organizerId] : []),
          ...attendeeIds,
        ]);
      }
      await events.append(meetingEvent('meeting.updated', next, actorId));
      return next;
    });
    const attendees =
      (await this.deps.uow.repos.meetings.attendees([meetingId])).get(meetingId) ?? [];
    return view(this.deps, actorId, updated, attendees, true);
  }
}

export class DeleteMeeting {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, meetingId: string) {
    const { meeting } = await authorize(this.deps, actorId, meetingId, 'edit');
    await this.deps.uow.transaction(async ({ meetings, events }) => {
      await meetings.delete(meetingId);
      await events.append(meetingEvent('meeting.deleted', meeting, actorId));
    });
  }
}

export class RespondToMeeting {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, meetingId: string, response: Exclude<RsvpResponse, 'pending'>) {
    const { meeting } = await authorize(this.deps, actorId, meetingId, 'rsvp');
    await this.deps.uow.transaction(async ({ meetings, events }) => {
      await meetings.respond(meetingId, actorId, response);
      await events.append(meetingEvent('meeting.updated', meeting, actorId));
    });
    return new GetMeeting(this.deps).execute(actorId, meetingId);
  }
}

export class LinkMeetingTask {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, meetingId: string, taskId: string, link: boolean) {
    const { meeting } = await authorize(this.deps, actorId, meetingId, 'edit');
    if (link) {
      const task = await this.deps.uow.repos.tasks.findById(taskId);
      if (!task || task.workspaceId !== meeting.workspaceId)
        throw notFound('task_not_found', 'Task not found');
      await this.deps.projectAccess.authorize(actorId, task.projectId, 'project:read', () =>
        notFound('task_not_found', 'Task not found'),
      );
    }
    await this.deps.uow.transaction(async ({ meetings, events }) => {
      if (link) await meetings.linkTask(meetingId, taskId);
      else if (!(await meetings.unlinkTask(meetingId, taskId))) {
        throw notFound('link_not_found', 'That task is not linked');
      }
      await events.append(meetingEvent('meeting.updated', meeting, actorId));
    });
    return new GetMeeting(this.deps).execute(actorId, meetingId);
  }
}

export class OpenMeetingNotes {
  constructor(private readonly deps: Deps) {}

  /**
   * Returns the meeting's notes doc id, creating it on first use. Notes live with the
   * meeting's project (or the workspace) so everyone who can see the meeting can read them.
   */
  async execute(actorId: string, meetingId: string): Promise<{ docId: string }> {
    const { meeting, can } = await authorize(this.deps, actorId, meetingId, 'read');
    if (meeting.notesDocId) return { docId: meeting.notesDocId };
    if (!can('edit') && !can('rsvp')) {
      throw forbidden('forbidden', 'Only attendees and organizers can start meeting notes');
    }

    return this.deps.uow.transaction(async ({ meetings, docs, events }) => {
      const doc = await docs.create({
        workspaceId: meeting.workspaceId,
        projectId: meeting.projectId,
        title: notesTitle(meeting),
        body: notesTemplate(meeting),
        createdBy: actorId,
      });
      await docs.addSnapshot({
        docId: doc.id,
        version: doc.version,
        title: doc.title,
        body: doc.body,
        authorId: actorId,
      });
      for (const taskId of await meetings.linkedTaskIds(meetingId))
        await docs.linkTask(doc.id, taskId);
      await meetings.setNotesDoc(meetingId, doc.id);
      await events.append({
        workspaceId: doc.workspaceId,
        projectId: doc.projectId,
        type: 'doc.created',
        actorId,
        payload: { id: doc.id },
      });
      await events.append(meetingEvent('meeting.updated', meeting, actorId));
      return { docId: doc.id };
    });
  }
}

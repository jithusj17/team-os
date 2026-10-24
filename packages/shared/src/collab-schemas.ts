import { z } from 'zod';

// Docs and calendar meetings.

export const taskRef = z.object({
  id: z.uuid(),
  key: z.string(),
  title: z.string(),
  projectId: z.uuid(),
});
export type TaskRef = z.infer<typeof taskRef>;

// ---- Docs ----

export const docSummary = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid().nullable(),
  title: z.string(),
  updatedAt: z.coerce.date(),
  updatedBy: z.uuid().nullable(),
  createdBy: z.uuid().nullable(),
});
export type DocSummary = z.infer<typeof docSummary>;

export const doc = docSummary.extend({
  body: z.string(),
  /** Send back on update; a stale version gets 409 version_conflict. */
  version: z.number().int(),
  createdAt: z.coerce.date(),
  linkedTasks: z.array(taskRef),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});
export type Doc = z.infer<typeof doc>;

export const createDocBody = z.object({
  title: z.string().trim().min(1).max(200).default('Untitled'),
  body: z.string().max(200_000).default(''),
  projectId: z.uuid().nullable().default(null),
});

export const updateDocBody = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(200_000).optional(),
  })
  .refine((b) => b.title !== undefined || b.body !== undefined, 'Provide a title or body');

export const docVersion = z.object({
  id: z.uuid(),
  version: z.number().int(),
  title: z.string(),
  authorId: z.uuid().nullable(),
  createdAt: z.coerce.date(),
});
export const docVersionDetail = docVersion.extend({ body: z.string() });

export const listDocsQuery = z.object({
  projectId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
});

export const linkTaskBody = z.object({ taskId: z.uuid() });

// ---- Meetings ----

export const rsvpResponses = ['pending', 'accepted', 'tentative', 'declined'] as const;
export const rsvpResponse = z.enum(rsvpResponses);
export type RsvpResponse = z.infer<typeof rsvpResponse>;

export const meetingAttendee = z.object({ userId: z.uuid(), response: rsvpResponse });

export const meeting = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid().nullable(),
  title: z.string(),
  description: z.string(),
  location: z.string(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  organizerId: z.uuid().nullable(),
  notesDocId: z.uuid().nullable(),
  attendees: z.array(meetingAttendee),
  linkedTasks: z.array(taskRef),
  version: z.number().int(),
  canEdit: z.boolean(),
});
export type Meeting = z.infer<typeof meeting>;

const meetingFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  location: z.string().trim().max(500),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  attendeeIds: z.array(z.uuid()).max(100),
};

const endsAfterStart = (m: { startsAt?: string; endsAt?: string }) =>
  !m.startsAt || !m.endsAt || new Date(m.endsAt) > new Date(m.startsAt);

export const createMeetingBody = z
  .object({
    ...meetingFields,
    description: meetingFields.description.default(''),
    location: meetingFields.location.default(''),
    attendeeIds: meetingFields.attendeeIds.default([]),
    projectId: z.uuid().nullable().default(null),
  })
  .refine(endsAfterStart, { message: 'The meeting must end after it starts', path: ['endsAt'] });

export const updateMeetingBody = z
  .object({
    version: z.number().int().positive(),
    title: meetingFields.title.optional(),
    description: meetingFields.description.optional(),
    location: meetingFields.location.optional(),
    startsAt: meetingFields.startsAt.optional(),
    endsAt: meetingFields.endsAt.optional(),
    attendeeIds: meetingFields.attendeeIds.optional(),
  })
  .refine(endsAfterStart, { message: 'The meeting must end after it starts', path: ['endsAt'] });

export const listMeetingsQuery = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    /** Only meetings I organize or attend. */
    mine: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .refine((q) => new Date(q.to).getTime() - new Date(q.from).getTime() <= 62 * 86_400_000, {
    message: 'Ask for at most 62 days at a time',
    path: ['to'],
  });

export const rsvpBody = z.object({ response: rsvpResponse.exclude(['pending']) });

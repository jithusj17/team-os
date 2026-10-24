import { and, asc, eq, gt, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { meetingAttendees, meetingTaskLinks, meetings } from '../../../infrastructure/db/schema.js';
import type { Attendee, Meeting, RsvpResponse } from '../domain/meeting.js';
import type { MeetingRepository } from '../domain/ports.js';

const columns = {
  id: meetings.id,
  workspaceId: meetings.workspaceId,
  projectId: meetings.projectId,
  title: meetings.title,
  description: meetings.description,
  location: meetings.location,
  startsAt: meetings.startsAt,
  endsAt: meetings.endsAt,
  organizerId: meetings.organizerId,
  notesDocId: meetings.notesDocId,
  version: meetings.version,
};

export class DrizzleMeetingRepository implements MeetingRepository {
  constructor(private readonly db: DbExecutor) {}

  async findById(id: string): Promise<Meeting | null> {
    const [row] = await this.db.select(columns).from(meetings).where(eq(meetings.id, id));
    return row ?? null;
  }

  listBetween(workspaceId: string, from: Date, to: Date) {
    return this.db
      .select(columns)
      .from(meetings)
      .where(
        and(
          eq(meetings.workspaceId, workspaceId),
          lt(meetings.startsAt, to),
          gt(meetings.endsAt, from),
        ),
      )
      .orderBy(asc(meetings.startsAt));
  }

  async create(data: Omit<Meeting, 'id' | 'version' | 'notesDocId'>) {
    const [row] = await this.db.insert(meetings).values(data).returning(columns);
    return row!;
  }

  async updateIfVersion(
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<Meeting, 'title' | 'description' | 'location' | 'startsAt' | 'endsAt'>>,
  ) {
    const [row] = await this.db
      .update(meetings)
      .set({ ...patch, version: sql`${meetings.version} + 1`, updatedAt: new Date() })
      .where(and(eq(meetings.id, id), eq(meetings.version, expectedVersion)))
      .returning(columns);
    return row ?? null;
  }

  async setNotesDoc(id: string, docId: string) {
    await this.db.update(meetings).set({ notesDocId: docId }).where(eq(meetings.id, id));
  }

  async delete(id: string) {
    await this.db.delete(meetings).where(eq(meetings.id, id));
  }

  async attendees(meetingIds: string[]) {
    const map = new Map<string, Attendee[]>();
    if (meetingIds.length === 0) return map;
    const rows = await this.db
      .select()
      .from(meetingAttendees)
      .where(inArray(meetingAttendees.meetingId, meetingIds));
    for (const { meetingId, userId, response } of rows) {
      map.set(meetingId, [...(map.get(meetingId) ?? []), { userId, response }]);
    }
    return map;
  }

  async setAttendees(meetingId: string, userIds: string[]) {
    const unique = [...new Set(userIds)];
    const removed = unique.length
      ? and(eq(meetingAttendees.meetingId, meetingId), notInArray(meetingAttendees.userId, unique))
      : eq(meetingAttendees.meetingId, meetingId);
    await this.db.delete(meetingAttendees).where(removed);
    if (unique.length) {
      await this.db
        .insert(meetingAttendees)
        .values(unique.map((userId) => ({ meetingId, userId })))
        .onConflictDoNothing();
    }
  }

  async respond(meetingId: string, userId: string, response: RsvpResponse) {
    const rows = await this.db
      .update(meetingAttendees)
      .set({ response })
      .where(and(eq(meetingAttendees.meetingId, meetingId), eq(meetingAttendees.userId, userId)))
      .returning({ userId: meetingAttendees.userId });
    return rows.length > 0;
  }

  async linkedTaskIds(meetingId: string) {
    const rows = await this.db
      .select({ taskId: meetingTaskLinks.taskId })
      .from(meetingTaskLinks)
      .where(eq(meetingTaskLinks.meetingId, meetingId));
    return rows.map((r) => r.taskId);
  }

  async linkTask(meetingId: string, taskId: string) {
    await this.db.insert(meetingTaskLinks).values({ meetingId, taskId }).onConflictDoNothing();
  }

  async unlinkTask(meetingId: string, taskId: string) {
    const rows = await this.db
      .delete(meetingTaskLinks)
      .where(and(eq(meetingTaskLinks.meetingId, meetingId), eq(meetingTaskLinks.taskId, taskId)))
      .returning({ taskId: meetingTaskLinks.taskId });
    return rows.length > 0;
  }
}

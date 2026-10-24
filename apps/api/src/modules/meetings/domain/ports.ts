import type { Attendee, Meeting, RsvpResponse } from './meeting.js';

export interface MeetingRepository {
  findById(id: string): Promise<Meeting | null>;
  /** Meetings overlapping [from, to) in a workspace. Visibility is filtered by the caller. */
  listBetween(workspaceId: string, from: Date, to: Date): Promise<Meeting[]>;
  create(data: Omit<Meeting, 'id' | 'version' | 'notesDocId'>): Promise<Meeting>;
  updateIfVersion(
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<Meeting, 'title' | 'description' | 'location' | 'startsAt' | 'endsAt'>>,
  ): Promise<Meeting | null>;
  setNotesDoc(id: string, docId: string): Promise<void>;
  delete(id: string): Promise<void>;

  attendees(meetingIds: string[]): Promise<Map<string, Attendee[]>>;
  /** Replaces the attendee list, keeping existing responses for people who stay. */
  setAttendees(meetingId: string, userIds: string[]): Promise<void>;
  respond(meetingId: string, userId: string, response: RsvpResponse): Promise<boolean>;

  linkedTaskIds(meetingId: string): Promise<string[]>;
  linkTask(meetingId: string, taskId: string): Promise<void>;
  unlinkTask(meetingId: string, taskId: string): Promise<boolean>;
}

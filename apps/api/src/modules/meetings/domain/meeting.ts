import type { RsvpResponse } from '@team-os/shared';

export type { RsvpResponse };

export interface Meeting {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  description: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
  organizerId: string | null;
  notesDocId: string | null;
  version: number;
}

export interface Attendee {
  userId: string;
  response: RsvpResponse;
}

const dateFmt = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Title for a meeting's notes doc, e.g. "Notes: Sprint planning (Oct 24, 2026)". */
export const notesTitle = (m: Pick<Meeting, 'title' | 'startsAt'>) =>
  `Notes: ${m.title} (${dateFmt.format(m.startsAt)})`;

/** A starter agenda so notes docs aren't a blank page. */
export function notesTemplate(m: Pick<Meeting, 'title' | 'description'>): string {
  const lines = [`# ${m.title}`, ''];
  if (m.description) lines.push(m.description, '');
  lines.push('## Agenda', '', '- ', '', '## Notes', '', '', '## Action items', '', '- [ ] ');
  return lines.join('\n');
}

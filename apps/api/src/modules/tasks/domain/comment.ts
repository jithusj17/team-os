import { MENTION_PATTERN } from '@team-os/shared';

export interface Comment {
  id: string;
  taskId: string;
  authorId: string | null;
  body: string;
  mentions: string[];
  createdAt: Date;
  editedAt: Date | null;
}

/** User IDs mentioned as <@userId> in a comment body, deduplicated, in order of appearance. */
export function parseMentions(body: string): string[] {
  const ids = [...body.matchAll(MENTION_PATTERN)].map((m) => m[1]!.toLowerCase());
  return [...new Set(ids)];
}

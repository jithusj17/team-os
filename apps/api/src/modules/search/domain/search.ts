import type { SearchSourceType } from '@team-os/shared';

export type { SearchSourceType };

/** What gets indexed for one task, comment, doc or meeting. */
export interface IndexableSource {
  sourceType: SearchSourceType;
  sourceId: string;
  workspaceId: string;
  projectId: string | null;
  taskId: string | null;
  title: string;
  content: string;
  /** People who can always see this (e.g. meeting attendees), beyond the normal rules. */
  allowedUserIds: string[];
}

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

/**
 * Splits text into chunks of about CHUNK_SIZE characters, preferring paragraph, then sentence,
 * then word boundaries, with a small overlap so a passage cut in two is still findable.
 */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const cut = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf(' '),
      );
      if (cut > size / 2) end = start + cut + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}

/**
 * A prefix-matching full-text query from free text: "bill sett" matches "billing settings".
 * Returns null when the text has no searchable words.
 */
export function toPrefixTsQuery(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

export interface RankedHit {
  key: string;
}

/**
 * Reciprocal Rank Fusion: merges ranked lists (keyword, semantic) without having to compare
 * their raw scores. Each list contributes 1 / (k + rank) for every item it contains.
 */
export function reciprocalRankFusion<T extends RankedHit>(
  lists: T[][],
  k = 60,
): { item: T; score: number }[] {
  const fused = new Map<string, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const entry = fused.get(item.key) ?? { item, score: 0 };
      entry.score += 1 / (k + rank + 1);
      fused.set(item.key, entry);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

/** Mention tokens (<@uuid>) are noise for search; keep the readable "@" only. */
export const stripMentions = (text: string) => text.replace(/<@[0-9a-f-]{36}>/gi, '@');

/**
 * Plain text from Markdown for indexing, so snippets read naturally: drops heading and list
 * markers, emphasis, code fences, link targets and table pipes.
 */
export function markdownToText(md: string): string {
  return (
    md
      .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, ''))
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Line-start patterns use [ \t], not \s, so they never swallow the newline before them.
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*>[ \t]?/gm, '')
      .replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/gm, '')
      .replace(/^[ \t]*([-*+]|\d+\.)[ \t]+/gm, '')
      .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, '')
      .replace(/\|/g, ' ')
      .replace(/(\*\*|__|~~|`)/g, '')
      // Single *emphasis*, but leave identifiers like snake_case alone.
      .replace(/(^|\s)\*(\S(?:[^*]*\S)?)\*(?=\s|$|[.,;:!?])/gm, '$1$2')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

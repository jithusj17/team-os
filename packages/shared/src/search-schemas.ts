import { z } from 'zod';

export const searchSourceTypes = ['task', 'comment', 'doc', 'meeting'] as const;
export const searchSourceType = z.enum(searchSourceTypes);
export type SearchSourceType = z.infer<typeof searchSourceType>;

/** Highlighted terms in snippets are wrapped in these markers (render them, don't show them). */
export const HIGHLIGHT_START = '\u0001';
export const HIGHLIGHT_END = '\u0002';

export const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  types: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(searchSourceType))
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchResult = z.object({
  type: searchSourceType,
  /** The id of the task, comment, doc or meeting. */
  id: z.uuid(),
  title: z.string(),
  snippet: z.string(),
  projectId: z.uuid().nullable(),
  /** For tasks and comments: the task to open. */
  taskId: z.uuid().nullable(),
  taskKey: z.string().nullable(),
  score: z.number(),
});
export type SearchResult = z.infer<typeof searchResult>;

export const searchResponse = z.object({
  results: z.array(searchResult),
  /** Whether semantic (embedding) search contributed, or only keyword search. */
  semantic: z.boolean(),
});
export type SearchResponse = z.infer<typeof searchResponse>;

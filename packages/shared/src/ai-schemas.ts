import { z } from 'zod';
import { taskPriority } from './work-schemas.js';

// ---- Streaming (Server-Sent Events) ----

/** Events on AI streaming endpoints, each sent as `data: <json>`. */
export const aiStreamEvent = z.discriminatedUnion('type', [
  /** Sources an answer may cite as [n] (ask endpoint only; sent first). */
  z.object({
    type: z.literal('sources'),
    sources: z.array(
      z.object({
        n: z.number().int(),
        type: z.enum(['task', 'comment', 'doc', 'meeting']),
        id: z.uuid(),
        title: z.string(),
        projectId: z.uuid().nullable(),
        taskId: z.uuid().nullable(),
        taskKey: z.string().nullable(),
      }),
    ),
  }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('done'), cached: z.boolean() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type AiStreamEvent = z.infer<typeof aiStreamEvent>;

export const aiStatus = z.object({ enabled: z.boolean() });

export const summaryTypes = ['task', 'project', 'meeting', 'doc'] as const;
export const summaryType = z.enum(summaryTypes);
export type SummaryType = z.infer<typeof summaryType>;

export const summarizeBody = z.object({ type: summaryType, id: z.uuid() });

export const askBody = z.object({ question: z.string().trim().min(2).max(1000) });

// ---- Actions ----

export const aiActionTypes = ['create_task', 'update_task', 'add_comment'] as const;

/**
 * An action as the model drafts it: people, projects, tasks and statuses by name or key.
 * The server resolves and validates every field. Kept free of constraints that structured
 * outputs can't express (lengths, formats); those are checked on resolution instead.
 */
export const aiDraftAction = z.object({
  type: z.enum(aiActionTypes),
  reason: z.string(),
  /** Project key for create_task (defaults to the request's project). */
  projectKey: z.string().nullable(),
  /** Task key (e.g. ENG-42) for update_task and add_comment. */
  taskKey: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  priority: taskPriority.nullable(),
  /** The assignee's email or name. */
  assignee: z.string().nullable(),
  /** A status name in the task's project. */
  status: z.string().nullable(),
  /** YYYY-MM-DD. */
  dueDate: z.string().nullable(),
  comment: z.string().nullable(),
});
export type AiDraftAction = z.infer<typeof aiDraftAction>;

export const aiDraftProposal = z.object({
  summary: z.string(),
  actions: z.array(aiDraftAction),
});
export type AiDraftProposal = z.infer<typeof aiDraftProposal>;

/** An action as validated by the server: ids resolved, plus a human-readable preview. */
export const aiAction = z.object({
  id: z.number().int(),
  type: z.enum(aiActionTypes),
  /** Why the AI proposed it, for the person reviewing. */
  reason: z.string(),
  /** Null when the action can run; otherwise why it can't. */
  error: z.string().nullable(),
  projectId: z.uuid().nullable(),
  projectKey: z.string().nullable(),
  taskId: z.uuid().nullable(),
  taskKey: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  priority: taskPriority.nullable(),
  assigneeId: z.uuid().nullable(),
  statusId: z.uuid().nullable(),
  dueDate: z.iso.date().nullable(),
  comment: z.string().nullable(),
});
export type AiAction = z.infer<typeof aiAction>;

export const proposeActionsBody = z.object({
  instruction: z.string().trim().min(3).max(2000),
  /** Default project for new tasks. */
  projectId: z.uuid().nullable().default(null),
  /** Content to work from, e.g. meeting notes. */
  source: z
    .union([
      z.object({ type: z.literal('meeting'), id: z.uuid() }),
      z.object({ type: z.literal('doc'), id: z.uuid() }),
      z.object({ type: z.literal('task'), id: z.uuid() }),
    ])
    .nullable()
    .default(null),
});

export const actionResult = z.object({
  actionId: z.number().int(),
  ok: z.boolean(),
  taskId: z.uuid().nullable(),
  taskKey: z.string().nullable(),
  error: z.string().nullable(),
});
export type ActionResult = z.infer<typeof actionResult>;

export const aiProposal = z.object({
  id: z.uuid(),
  instruction: z.string(),
  summary: z.string(),
  actions: z.array(aiAction),
  status: z.enum(['pending', 'executed']),
  results: z.array(actionResult).nullable(),
  createdAt: z.coerce.date(),
});
export type AiProposal = z.infer<typeof aiProposal>;

export const executeProposalBody = z.object({
  /** Which actions to run; defaults to every valid one. */
  actionIds: z.array(z.number().int()).optional(),
});

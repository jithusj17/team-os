import { taskPriorities, type TaskPriority, type TaskSort } from '@team-os/shared';
import type { Label } from './label.js';

export type { TaskPriority, TaskSort };

export interface Task {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  title: string;
  description: string;
  statusId: string;
  priority: TaskPriority;
  assigneeId: string | null;
  dueDate: string | null;
  estimate: number | null;
  parentId: string | null;
  sortOrder: number;
  version: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/** A task as returned to clients: with its human key, labels and subtask count. */
export interface TaskView extends Task {
  key: string;
  labels: Label[];
  subtaskCount: number;
  /** Blockers that are not yet done or canceled. */
  openBlockerCount: number;
}

export interface TaskFilter {
  statusIds?: string[];
  /** `null` in the list means "unassigned". */
  assigneeIds?: (string | null)[];
  labelIds?: string[];
  priorities?: TaskPriority[];
  /** A task ID for its subtasks, or `none` for top-level tasks. */
  parent?: string | 'none';
  search?: string;
}

// ---- Keys ----

export const formatTaskKey = (projectKey: string, number: number) => `${projectKey}-${number}`;

export function parseTaskKey(ref: string): { projectKey: string; number: number } | null {
  const match = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})$/.exec(ref);
  return match ? { projectKey: match[1]!.toUpperCase(), number: Number(match[2]) } : null;
}

// ---- Priority ----

/** Priorities are stored as 0..4 so they sort numerically. */
export const priorityToRank = (p: TaskPriority) => taskPriorities.indexOf(p);
export const rankToPriority = (rank: number): TaskPriority => taskPriorities[rank] ?? 'none';

// ---- Board ordering (fractional indexing) ----

export const SORT_GAP = 1024;
const MIN_GAP = 1e-6;

/**
 * A sort order between two neighbours. `after` is the task above, `before` the task below
 * (either may be missing at the ends of a column). Returns null when the neighbours are too
 * close together; the caller should then rebalance the column and try again.
 */
export function sortOrderBetween(after: number | null, before: number | null): number | null {
  if (after === null && before === null) return 0;
  if (after === null) return before! - SORT_GAP;
  if (before === null) return after + SORT_GAP;
  if (before - after < MIN_GAP) return null;
  return (after + before) / 2;
}

// ---- Change tracking ----

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

const TRACKED_FIELDS = [
  'title',
  'statusId',
  'priority',
  'assigneeId',
  'dueDate',
  'estimate',
  'parentId',
] as const satisfies (keyof Task)[];

/** Field-level changes for the activity log. Descriptions are recorded as "changed" only. */
export function diffTask(
  before: Task,
  after: Task,
  labels?: { before: string[]; after: string[] },
): FieldChanges {
  const changes: FieldChanges = {};
  for (const field of TRACKED_FIELDS) {
    if (before[field] !== after[field]) changes[field] = { from: before[field], to: after[field] };
  }
  if (before.description !== after.description) {
    changes.description = { from: null, to: null };
  }
  if (labels) {
    const added = labels.after.filter((l) => !labels.before.includes(l));
    const removed = labels.before.filter((l) => !labels.after.includes(l));
    if (added.length || removed.length) changes.labels = { from: removed, to: added };
  }
  return changes;
}

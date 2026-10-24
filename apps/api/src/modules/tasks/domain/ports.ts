import type { ActivityEntry } from '@team-os/shared';
import type { Comment } from './comment.js';
import type { DependencyEdge, DependencyTask, GraphNode } from './dependency.js';
import type { Label } from './label.js';
import type { FieldChanges, Task, TaskFilter, TaskSort, TaskView } from './task.js';

export interface TaskPage {
  items: TaskView[];
  nextCursor: string | null;
}

export interface TaskRepository {
  findById(id: string): Promise<Task | null>;
  findView(id: string): Promise<TaskView | null>;
  findViewByNumber(projectId: string, number: number): Promise<TaskView | null>;
  /** Throws an `invalid_cursor` validation error for malformed cursors. */
  list(
    projectId: string,
    filter: TaskFilter,
    sort: TaskSort,
    page: { cursor?: string; limit: number },
  ): Promise<TaskPage>;
  create(data: Omit<Task, 'id' | 'version' | 'createdAt' | 'updatedAt'>): Promise<Task>;
  /**
   * Applies `patch` only if the task is still at `expectedVersion`, bumping the version.
   * Returns null if the version no longer matches (someone else changed it first).
   */
  updateIfVersion(
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<Task, 'id' | 'version' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Task | null>;
  delete(id: string): Promise<void>;
  labelIds(taskId: string): Promise<string[]>;
  setLabels(taskId: string, labelIds: string[]): Promise<void>;
  /** Sort orders of the given tasks, for placing a task between neighbours. */
  positions(
    taskIds: string[],
  ): Promise<Map<string, { projectId: string; statusId: string; sortOrder: number }>>;
  maxSortOrder(projectId: string, statusId: string): Promise<number | null>;
  /** Re-spaces a column's sort orders evenly when fractional positions run out of precision. */
  rebalance(projectId: string, statusId: string): Promise<void>;
  /** Key and title for each task id that exists (for showing links from docs and meetings). */
  findRefs(ids: string[]): Promise<{ id: string; key: string; title: string; projectId: string }[]>;
  /** IDs of the task's ancestors (parent, grandparent, ...). */
  ancestorIds(taskId: string): Promise<string[]>;
  /** Open, assigned tasks due between two dates (inclusive, YYYY-MM-DD). */
  findDueBetween(
    from: string,
    to: string,
  ): Promise<
    (Pick<TaskView, 'id' | 'key' | 'title' | 'projectId' | 'workspaceId' | 'dueDate'> & {
      assigneeId: string;
    })[]
  >;
}

export interface LabelRepository {
  list(workspaceId: string): Promise<Label[]>;
  findById(workspaceId: string, id: string): Promise<Label | null>;
  /** Of `ids`, those that are labels in the workspace. */
  existingIds(workspaceId: string, ids: string[]): Promise<string[]>;
  /** Throws a `label_exists` conflict on duplicate names. */
  create(workspaceId: string, data: Omit<Label, 'id'>): Promise<Label>;
  update(workspaceId: string, id: string, patch: Partial<Omit<Label, 'id'>>): Promise<Label | null>;
  delete(workspaceId: string, id: string): Promise<boolean>;
}

export interface CommentRepository {
  list(taskId: string): Promise<Comment[]>;
  findById(id: string): Promise<Comment | null>;
  create(data: {
    taskId: string;
    authorId: string;
    body: string;
    mentions: string[];
  }): Promise<Comment>;
  update(id: string, data: { body: string; mentions: string[]; editedAt: Date }): Promise<Comment>;
  delete(id: string): Promise<void>;
}

export interface ActivityRepository {
  record(entry: {
    taskId: string;
    actorId: string;
    type: ActivityEntry['type'];
    changes?: FieldChanges | null;
    commentId?: string | null;
  }): Promise<void>;
  list(taskId: string): Promise<ActivityEntry[]>;
}

export interface DependencyRepository {
  /** Serializes dependency writes within a workspace (held until the transaction ends). */
  lockWorkspace(workspaceId: string): Promise<void>;
  /** Throws a `dependency_exists` conflict if the edge already exists. */
  add(edge: DependencyEdge & { workspaceId: string; createdBy: string }): Promise<void>;
  remove(edge: DependencyEdge): Promise<boolean>;
  /** Whether `toTaskId` can be reached from `fromTaskId` by following blocker -> blocked edges. */
  isReachable(fromTaskId: string, toTaskId: string): Promise<boolean>;
  forTask(taskId: string): Promise<{ blockedBy: DependencyTask[]; blocking: DependencyTask[] }>;
  openBlockers(taskId: string): Promise<DependencyTask[]>;
  /** The project's tasks, external tasks linked to them, and the edges between them. */
  projectGraph(projectId: string): Promise<{ nodes: GraphNode[]; edges: DependencyEdge[] }>;
}

/** Users following a task: notified about comments and status changes. */
export interface WatcherRepository {
  /** Adds watchers, ignoring ones already watching. */
  add(taskId: string, userIds: string[]): Promise<void>;
  remove(taskId: string, userId: string): Promise<boolean>;
  list(taskId: string): Promise<string[]>;
}

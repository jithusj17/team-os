import { z } from 'zod';
import { projectRoles, projectVisibilities } from './permissions.js';

// Projects, statuses, labels, tasks and comments.

export const projectRole = z.enum(projectRoles);
export const projectVisibility = z.enum(projectVisibilities);

/** Short uppercase project key used in task IDs, e.g. ENG in ENG-42. */
export const projectKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Use 2-10 letters or digits, starting with a letter');

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #4f46e5');

// ---- Statuses ----

/** Status categories drive behaviour: e.g. `done` completes a task and unblocks dependents. */
export const statusCategories = ['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const;
export const statusCategory = z.enum(statusCategories);
export type StatusCategory = z.infer<typeof statusCategory>;

export const projectStatus = z.object({
  id: z.uuid(),
  name: z.string(),
  category: statusCategory,
  color: z.string(),
  position: z.number().int(),
});
export type ProjectStatus = z.infer<typeof projectStatus>;

export const createStatusBody = z.object({
  name: z.string().trim().min(1).max(40),
  category: statusCategory,
  color: hexColor.default('#6b7280'),
});

export const updateStatusBody = z
  .object({
    name: z.string().trim().min(1).max(40),
    category: statusCategory,
    color: hexColor,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field');

export const reorderStatusesBody = z.object({ statusIds: z.array(z.uuid()).min(1) });

// ---- Projects ----

export const project = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  visibility: projectVisibility,
  /** When true, tasks can't move to a done status while a blocker is still open. */
  enforceDependencies: z.boolean(),
  role: projectRole,
  createdAt: z.coerce.date(),
});
export type Project = z.infer<typeof project>;

export const projectDetail = project.extend({ statuses: z.array(projectStatus) });
export type ProjectDetail = z.infer<typeof projectDetail>;

export const createProjectBody = z.object({
  name: z.string().trim().min(1).max(80),
  key: projectKey,
  description: z.string().max(5000).default(''),
  visibility: projectVisibility.default('workspace'),
});

export const updateProjectBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(5000),
    visibility: projectVisibility,
    enforceDependencies: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field');

export const projectMember = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.email(),
  avatarUrl: z.string().nullable(),
  role: projectRole,
});
export type ProjectMember = z.infer<typeof projectMember>;

export const setProjectMemberBody = z.object({ role: projectRole });

// ---- Labels ----

export const label = z.object({ id: z.uuid(), name: z.string(), color: z.string() });
export type Label = z.infer<typeof label>;

export const createLabelBody = z.object({
  name: z.string().trim().min(1).max(40),
  color: hexColor.default('#6b7280'),
});
export const updateLabelBody = createLabelBody.partial();

// ---- Tasks ----

export const taskPriorities = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export const taskPriority = z.enum(taskPriorities);
export type TaskPriority = z.infer<typeof taskPriority>;

const isoDate = z.iso.date();

export const task = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  /** Human-readable ID, e.g. ENG-42. */
  key: z.string(),
  number: z.number().int(),
  title: z.string(),
  description: z.string(),
  statusId: z.uuid(),
  priority: taskPriority,
  assigneeId: z.uuid().nullable(),
  labels: z.array(label),
  dueDate: isoDate.nullable(),
  estimate: z.number().int().nullable(),
  parentId: z.uuid().nullable(),
  subtaskCount: z.number().int(),
  /** Blockers that are not yet done or canceled. */
  openBlockerCount: z.number().int(),
  sortOrder: z.number(),
  /** Incremented on every change; send it back on update to detect conflicting edits. */
  version: z.number().int(),
  createdBy: z.uuid().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});
export type Task = z.infer<typeof task>;

const taskFields = {
  title: z.string().trim().min(1).max(500),
  description: z.string().max(50_000),
  statusId: z.uuid(),
  priority: taskPriority,
  assigneeId: z.uuid().nullable(),
  labelIds: z.array(z.uuid()).max(20),
  dueDate: isoDate.nullable(),
  estimate: z.number().int().min(0).max(1000).nullable(),
  parentId: z.uuid().nullable(),
};

export const createTaskBody = z.object({
  title: taskFields.title,
  description: taskFields.description.default(''),
  statusId: taskFields.statusId.optional(),
  priority: taskFields.priority.default('none'),
  assigneeId: taskFields.assigneeId.default(null),
  labelIds: taskFields.labelIds.default([]),
  dueDate: taskFields.dueDate.default(null),
  estimate: taskFields.estimate.default(null),
  parentId: taskFields.parentId.default(null),
});

/** Where to place a task on the board: between two neighbours in its (new) status column. */
export const taskPosition = z.object({
  afterTaskId: z.uuid().nullable().default(null),
  beforeTaskId: z.uuid().nullable().default(null),
});

export const updateTaskBody = z
  .object({
    version: z.number().int().positive(),
    title: taskFields.title.optional(),
    description: taskFields.description.optional(),
    statusId: taskFields.statusId.optional(),
    priority: taskFields.priority.optional(),
    assigneeId: taskFields.assigneeId.optional(),
    labelIds: taskFields.labelIds.optional(),
    dueDate: taskFields.dueDate.optional(),
    estimate: taskFields.estimate.optional(),
    parentId: taskFields.parentId.optional(),
    position: taskPosition.optional(),
  })
  .refine((b) => Object.keys(b).length > 1, 'Provide at least one field to change');
export type UpdateTaskBody = z.infer<typeof updateTaskBody>;

export const taskSorts = ['position', 'created', 'updated', 'priority', 'due'] as const;
export const taskSort = z.enum(taskSorts);
export type TaskSort = z.infer<typeof taskSort>;

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(item));

export const listTasksQuery = z.object({
  status: csv(z.uuid()).optional(),
  /** User IDs, `me`, or `none` for unassigned. */
  assignee: csv(z.union([z.uuid(), z.literal('me'), z.literal('none')])).optional(),
  label: csv(z.uuid()).optional(),
  priority: csv(taskPriority).optional(),
  /** A task ID for its subtasks, or `none` for top-level tasks only. */
  parent: z.union([z.uuid(), z.literal('none')]).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort: taskSort.default('position'),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListTasksQuery = z.infer<typeof listTasksQuery>;

export const taskList = z.object({ items: z.array(task), nextCursor: z.string().nullable() });

// ---- Comments ----

/** Mentions are written as <@userId> in comment bodies. */
export const MENTION_PATTERN =
  /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;

export const comment = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  authorId: z.uuid().nullable(),
  body: z.string(),
  mentions: z.array(z.uuid()),
  createdAt: z.coerce.date(),
  editedAt: z.coerce.date().nullable(),
});
export type Comment = z.infer<typeof comment>;

export const commentBody = z.object({ body: z.string().trim().min(1).max(10_000) });

// ---- Activity ----

export const fieldChange = z.object({ from: z.unknown(), to: z.unknown() });

export const activityEntry = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  actorId: z.uuid().nullable(),
  type: z.enum([
    'task.created',
    'task.updated',
    'comment.created',
    'comment.updated',
    'comment.deleted',
    'dependency.added',
    'dependency.removed',
  ]),
  changes: z.record(z.string(), fieldChange).nullable(),
  commentId: z.uuid().nullable(),
  createdAt: z.coerce.date(),
});
export type ActivityEntry = z.infer<typeof activityEntry>;

// ---- Dependencies ----

/** A task on one end of a dependency, possibly in another project. */
export const dependencyTask = z.object({
  id: z.uuid(),
  key: z.string(),
  title: z.string(),
  projectId: z.uuid(),
  statusCategory: statusCategory,
  /** Done or canceled: no longer blocks anything. */
  closed: z.boolean(),
});
export type DependencyTask = z.infer<typeof dependencyTask>;

export const taskDependencies = z.object({
  blockedBy: z.array(dependencyTask),
  blocking: z.array(dependencyTask),
  /** Dependencies on tasks in projects the viewer can't see are counted but not shown. */
  hiddenCount: z.number().int(),
});

export const addDependencyBody = z.object({ blockerId: z.uuid() });

export const dependencyGraph = z.object({
  nodes: z.array(
    dependencyTask.extend({
      estimate: z.number().int().nullable(),
      /** True for tasks from other projects that block or are blocked by this project's tasks. */
      external: z.boolean(),
    }),
  ),
  edges: z.array(z.object({ blockerId: z.uuid(), blockedId: z.uuid() })),
  /**
   * The longest chain of open work through the graph, weighted by estimate (1 when unset):
   * the sequence that determines the earliest possible finish.
   */
  criticalPath: z.object({ taskIds: z.array(z.uuid()), length: z.number() }),
});
export type DependencyGraph = z.infer<typeof dependencyGraph>;

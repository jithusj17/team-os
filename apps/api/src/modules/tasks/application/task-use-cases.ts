import type { ActivityEntry, ListTasksQuery, ProjectAction, UpdateTaskBody } from '@team-os/shared';
import type { Clock } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { conflict, notFound, validation } from '../../../shared/domain/errors.js';
import type { ProjectAccess, ProjectGrant } from '../../projects/application/project-access.js';
import { defaultStatus, isClosedCategory, type Status } from '../../projects/domain/project.js';
import type { ProjectRepository, StatusRepository } from '../../projects/domain/ports.js';
import type {
  ActivityRepository,
  DependencyRepository,
  LabelRepository,
  TaskPage,
  TaskRepository,
} from '../domain/ports.js';
import {
  SORT_GAP,
  diffTask,
  parseTaskKey,
  sortOrderBetween,
  type Task,
  type TaskFilter,
  type TaskPriority,
  type TaskView,
} from '../domain/task.js';

type Repos = {
  tasks: TaskRepository;
  labels: LabelRepository;
  activity: ActivityRepository;
  dependencies: DependencyRepository;
  statuses: StatusRepository;
  projects: ProjectRepository;
};
type Deps = { uow: UnitOfWork<Repos>; projectAccess: ProjectAccess; clock: Clock };

export const taskNotFound = () => notFound('task_not_found', 'Task not found');

/** Authorizes an action on a task through its project. Hidden tasks are not-found. */
export class TaskAccess {
  constructor(
    private readonly deps: {
      tasks: Pick<TaskRepository, 'findById'>;
      projectAccess: ProjectAccess;
    },
  ) {}

  async authorize(
    actorId: string,
    taskId: string,
    action: ProjectAction,
  ): Promise<{ task: Task; grant: ProjectGrant }> {
    const task = await this.deps.tasks.findById(taskId);
    if (!task) throw taskNotFound();
    const grant = await this.deps.projectAccess.authorize(
      actorId,
      task.projectId,
      action,
      taskNotFound,
    );
    return { task, grant };
  }
}

// ---- Shared rules for create and update ----

interface References {
  statusId?: string;
  assigneeId?: string | null;
  labelIds?: string[];
  parentId?: string | null;
}

/** Validates that every referenced status, assignee, label and parent is usable here. */
async function validateReferences(
  repos: Repos,
  projectAccess: ProjectAccess,
  project: { id: string; workspaceId: string },
  refs: References,
  statuses: Status[],
  taskId?: string,
) {
  if (refs.statusId !== undefined && !statuses.some((s) => s.id === refs.statusId)) {
    throw validation('invalid_status', 'That status does not belong to this project');
  }
  if (refs.assigneeId) {
    if (!(await projectAccess.grantFor(refs.assigneeId, project.id))) {
      throw validation('invalid_assignee', 'The assignee must have access to this project');
    }
  }
  if (refs.labelIds?.length) {
    const unique = [...new Set(refs.labelIds)];
    const existing = await repos.labels.existingIds(project.workspaceId, unique);
    if (existing.length !== unique.length) {
      throw validation('invalid_label', 'One or more labels do not exist in this workspace');
    }
  }
  if (refs.parentId) {
    const parent = await repos.tasks.findById(refs.parentId);
    if (!parent || parent.projectId !== project.id) {
      throw validation('invalid_parent', 'The parent task must be in the same project');
    }
    if (
      taskId &&
      (refs.parentId === taskId || (await repos.tasks.ancestorIds(refs.parentId)).includes(taskId))
    ) {
      throw conflict('parent_cycle', 'A task cannot be nested under itself or its own subtasks');
    }
  }
}

/** Computes a board position in `statusId`'s column, rebalancing the column if needed. */
async function placeInColumn(
  tasks: TaskRepository,
  projectId: string,
  statusId: string,
  position: { afterTaskId: string | null; beforeTaskId: string | null } | undefined,
  movingTaskId?: string,
): Promise<number> {
  if (!position || (!position.afterTaskId && !position.beforeTaskId)) {
    return ((await tasks.maxSortOrder(projectId, statusId)) ?? 0) + SORT_GAP;
  }
  const neighbourIds = [position.afterTaskId, position.beforeTaskId].filter(
    (id): id is string => !!id,
  );

  const compute = async () => {
    const found = await tasks.positions(neighbourIds);
    for (const id of neighbourIds) {
      const n = found.get(id);
      if (!n || n.projectId !== projectId || n.statusId !== statusId || id === movingTaskId) {
        throw validation('invalid_position', 'Neighbouring tasks must be in the target column');
      }
    }
    const order = (id: string | null) => (id ? found.get(id)!.sortOrder : null);
    return sortOrderBetween(order(position.afterTaskId), order(position.beforeTaskId));
  };

  const first = await compute();
  if (first !== null) return first;
  await tasks.rebalance(projectId, statusId);
  return (await compute())!;
}

// ---- Use cases ----

export class ListTasks {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, projectId: string, query: ListTasksQuery): Promise<TaskPage> {
    await this.deps.projectAccess.authorize(actorId, projectId, 'project:read');
    const filter: TaskFilter = {
      statusIds: query.status,
      assigneeIds: query.assignee?.map((a) => (a === 'me' ? actorId : a === 'none' ? null : a)),
      labelIds: query.label,
      priorities: query.priority,
      parent: query.parent,
      search: query.q,
    };
    return this.deps.uow.repos.tasks.list(projectId, filter, query.sort, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}

export class GetTask {
  constructor(private readonly deps: Deps & { taskAccess: TaskAccess }) {}

  async execute(actorId: string, taskId: string): Promise<TaskView> {
    await this.deps.taskAccess.authorize(actorId, taskId, 'project:read');
    const view = await this.deps.uow.repos.tasks.findView(taskId);
    if (!view) throw taskNotFound();
    return view;
  }
}

export class GetTaskByKey {
  constructor(private readonly deps: Deps) {}

  /** Looks up a task by its human key (e.g. ENG-42) within a workspace. */
  async execute(actorId: string, workspaceId: string, key: string): Promise<TaskView> {
    const parsed = parseTaskKey(key);
    if (!parsed) throw taskNotFound();
    const { projects, tasks } = this.deps.uow.repos;
    const project = await projects.findByKey(workspaceId, parsed.projectKey);
    if (!project) throw taskNotFound();
    await this.deps.projectAccess.authorize(actorId, project.id, 'project:read', taskNotFound);
    const view = await tasks.findViewByNumber(project.id, parsed.number);
    if (!view) throw taskNotFound();
    return view;
  }
}

export interface CreateTaskInput {
  title: string;
  description: string;
  statusId?: string;
  priority: TaskPriority;
  assigneeId: string | null;
  labelIds: string[];
  dueDate: string | null;
  estimate: number | null;
  parentId: string | null;
}

export class CreateTask {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, projectId: string, input: CreateTaskInput): Promise<TaskView> {
    const { uow, projectAccess, clock } = this.deps;
    const { project } = await projectAccess.authorize(actorId, projectId, 'task:create');

    return uow.transaction(async (repos) => {
      const statuses = await repos.statuses.listForProject(projectId);
      await validateReferences(repos, projectAccess, project, input, statuses);
      const status = input.statusId
        ? statuses.find((s) => s.id === input.statusId)!
        : defaultStatus(statuses);
      if (!status) throw validation('invalid_status', 'This project has no statuses');

      const { labelIds, statusId: _ignored, ...fields } = input;
      const task = await repos.tasks.create({
        ...fields,
        workspaceId: project.workspaceId,
        projectId,
        number: await repos.projects.nextTaskNumber(projectId),
        statusId: status.id,
        sortOrder: await placeInColumn(repos.tasks, projectId, status.id, undefined),
        createdBy: actorId,
        completedAt: isClosedCategory(status.category) ? clock.now() : null,
      });
      if (labelIds.length) await repos.tasks.setLabels(task.id, [...new Set(labelIds)]);
      await repos.activity.record({ taskId: task.id, actorId, type: 'task.created' });
      return (await repos.tasks.findView(task.id))!;
    });
  }
}

export class UpdateTask {
  constructor(private readonly deps: Deps & { taskAccess: TaskAccess }) {}

  async execute(actorId: string, taskId: string, input: UpdateTaskBody): Promise<TaskView> {
    const { uow, projectAccess, clock, taskAccess } = this.deps;
    const { task: current, grant } = await taskAccess.authorize(actorId, taskId, 'task:update');
    const versionConflict = () =>
      conflict('version_conflict', 'This task was changed by someone else. Reload and try again.');
    if (current.version !== input.version) throw versionConflict();

    return uow.transaction(async (repos) => {
      const { version, position, labelIds, ...fields } = input;
      const statuses = await repos.statuses.listForProject(current.projectId);
      await validateReferences(
        repos,
        projectAccess,
        grant.project,
        { ...fields, labelIds },
        statuses,
        taskId,
      );

      const patch: Partial<Task> = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      );
      const statusChanged = fields.statusId !== undefined && fields.statusId !== current.statusId;
      const targetStatusId = fields.statusId ?? current.statusId;
      if (position || statusChanged) {
        patch.sortOrder = await placeInColumn(
          repos.tasks,
          current.projectId,
          targetStatusId,
          position,
          taskId,
        );
      }
      if (statusChanged) {
        const category = statuses.find((s) => s.id === targetStatusId)!.category;
        if (category === 'done' && grant.project.enforceDependencies) {
          const open = await repos.dependencies.openBlockers(taskId);
          if (open.length > 0) {
            throw conflict(
              'blocked_by_open_tasks',
              `Finish the blocking tasks first: ${open.map((t) => t.key).join(', ')}`,
            );
          }
        }
        patch.completedAt = isClosedCategory(category)
          ? (current.completedAt ?? clock.now())
          : null;
      }

      // The version check makes concurrent edits fail loudly instead of overwriting each other.
      const updated = await repos.tasks.updateIfVersion(taskId, version, patch);
      if (!updated) throw versionConflict();

      let labelDiff: { before: string[]; after: string[] } | undefined;
      if (labelIds) {
        const after = [...new Set(labelIds)];
        labelDiff = { before: await repos.tasks.labelIds(taskId), after };
        await repos.tasks.setLabels(taskId, after);
      }
      const changes = diffTask(current, updated, labelDiff);
      if (Object.keys(changes).length > 0) {
        await repos.activity.record({ taskId, actorId, type: 'task.updated', changes });
      }
      return (await repos.tasks.findView(taskId))!;
    });
  }
}

export class DeleteTask {
  constructor(private readonly deps: Deps & { taskAccess: TaskAccess }) {}

  async execute(actorId: string, taskId: string) {
    await this.deps.taskAccess.authorize(actorId, taskId, 'task:delete');
    await this.deps.uow.repos.tasks.delete(taskId);
  }
}

export class ListTaskActivity {
  constructor(private readonly deps: Deps & { taskAccess: TaskAccess }) {}

  async execute(actorId: string, taskId: string): Promise<ActivityEntry[]> {
    await this.deps.taskAccess.authorize(actorId, taskId, 'project:read');
    return this.deps.uow.repos.activity.list(taskId);
  }
}

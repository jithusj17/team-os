import type { DependencyGraph } from '@team-os/shared';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { conflict, notFound, validation } from '../../../shared/domain/errors.js';
import type { ProjectAccess } from '../../projects/application/project-access.js';
import { criticalPath, type DependencyTask } from '../domain/dependency.js';
import type { ActivityRepository, DependencyRepository, TaskRepository } from '../domain/ports.js';
import type { TaskAccess } from './task-use-cases.js';

type Deps = {
  uow: UnitOfWork<{
    tasks: TaskRepository;
    dependencies: DependencyRepository;
    activity: ActivityRepository;
  }>;
  taskAccess: TaskAccess;
  projectAccess: ProjectAccess;
};

/** Filters tasks down to those in projects the user can see (checking each project once). */
async function visibleTo(
  projectAccess: ProjectAccess,
  userId: string,
  tasks: { projectId: string }[],
): Promise<(projectId: string) => boolean> {
  const projectIds = [...new Set(tasks.map((t) => t.projectId))];
  const grants = await Promise.all(projectIds.map((id) => projectAccess.grantFor(userId, id)));
  const visible = new Set(projectIds.filter((_, i) => grants[i] !== null));
  return (projectId) => visible.has(projectId);
}

export class ListDependencies {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, taskId: string) {
    await this.deps.taskAccess.authorize(actorId, taskId, 'project:read');
    const { blockedBy, blocking } = await this.deps.uow.repos.dependencies.forTask(taskId);
    const canSee = await visibleTo(this.deps.projectAccess, actorId, [...blockedBy, ...blocking]);
    const shown = (list: DependencyTask[]) => list.filter((t) => canSee(t.projectId));
    return {
      blockedBy: shown(blockedBy),
      blocking: shown(blocking),
      hiddenCount:
        blockedBy.length + blocking.length - shown(blockedBy).length - shown(blocking).length,
    };
  }
}

export class AddDependency {
  constructor(private readonly deps: Deps) {}

  /** Records that `blockerId` blocks `taskId`. */
  async execute(actorId: string, taskId: string, blockerId: string) {
    const { uow, taskAccess } = this.deps;
    if (taskId === blockerId) throw validation('self_dependency', 'A task cannot block itself');

    const { task } = await taskAccess.authorize(actorId, taskId, 'task:update');
    const blockerNotFound = () => notFound('blocker_not_found', 'Blocking task not found');
    const blocker = await uow.repos.tasks.findById(blockerId);
    if (!blocker || blocker.workspaceId !== task.workspaceId) throw blockerNotFound();
    await this.deps.projectAccess.authorize(
      actorId,
      blocker.projectId,
      'project:read',
      blockerNotFound,
    );

    await uow.transaction(async ({ dependencies, activity }) => {
      // Two concurrent inserts (A blocks B, B blocks A) could each pass the cycle check alone;
      // a workspace-wide lock makes the check-then-insert atomic.
      await dependencies.lockWorkspace(task.workspaceId);
      if (await dependencies.isReachable(taskId, blockerId)) {
        throw conflict('dependency_cycle', 'This would create a circular dependency');
      }
      await dependencies.add({
        blockerId,
        blockedId: taskId,
        workspaceId: task.workspaceId,
        createdBy: actorId,
      });
      await activity.record({
        taskId,
        actorId,
        type: 'dependency.added',
        changes: { blockedBy: { from: null, to: blockerId } },
      });
    });
  }
}

export class RemoveDependency {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, taskId: string, blockerId: string) {
    await this.deps.taskAccess.authorize(actorId, taskId, 'task:update');
    await this.deps.uow.transaction(async ({ dependencies, activity }) => {
      if (!(await dependencies.remove({ blockerId, blockedId: taskId }))) {
        throw notFound('dependency_not_found', 'Dependency not found');
      }
      await activity.record({
        taskId,
        actorId,
        type: 'dependency.removed',
        changes: { blockedBy: { from: blockerId, to: null } },
      });
    });
  }
}

export class GetDependencyGraph {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, projectId: string): Promise<DependencyGraph> {
    await this.deps.projectAccess.authorize(actorId, projectId, 'project:read');
    const graph = await this.deps.uow.repos.dependencies.projectGraph(projectId);

    // External tasks from projects the viewer can't see are dropped, with their edges.
    const canSee = await visibleTo(this.deps.projectAccess, actorId, graph.nodes);
    const nodes = graph.nodes.filter((n) => canSee(n.projectId));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => ids.has(e.blockerId) && ids.has(e.blockedId));
    return { nodes, edges, criticalPath: criticalPath(nodes, edges) };
  }
}

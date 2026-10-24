import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { isUniqueViolation, type DbExecutor } from '../../../infrastructure/db/executor.js';
import {
  projectStatuses,
  projects,
  taskDependencies,
  tasks,
} from '../../../infrastructure/db/schema.js';
import { conflict } from '../../../shared/domain/errors.js';
import type { DependencyEdge, DependencyTask, GraphNode } from '../domain/dependency.js';
import type { DependencyRepository } from '../domain/ports.js';
import { formatTaskKey } from '../domain/task.js';

const taskRefColumns = {
  id: tasks.id,
  number: tasks.number,
  title: tasks.title,
  projectId: tasks.projectId,
  projectKey: projects.key,
  statusCategory: projectStatuses.category,
  estimate: tasks.estimate,
};

type RefRow = {
  id: string;
  number: number;
  title: string;
  projectId: string;
  projectKey: string;
  statusCategory: DependencyTask['statusCategory'];
  estimate: number | null;
};

const toRef = (r: RefRow): DependencyTask => ({
  id: r.id,
  key: formatTaskKey(r.projectKey, r.number),
  title: r.title,
  projectId: r.projectId,
  statusCategory: r.statusCategory,
  closed: r.statusCategory === 'done' || r.statusCategory === 'canceled',
});

export class DrizzleDependencyRepository implements DependencyRepository {
  constructor(private readonly db: DbExecutor) {}

  private refs() {
    return this.db
      .select(taskRefColumns)
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(projectStatuses, eq(projectStatuses.id, tasks.statusId));
  }

  async lockWorkspace(workspaceId: string) {
    await this.db.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`task-deps:${workspaceId}`}))`,
    );
  }

  async add(edge: DependencyEdge & { workspaceId: string; createdBy: string }) {
    try {
      await this.db.insert(taskDependencies).values(edge);
    } catch (err) {
      if (isUniqueViolation(err))
        throw conflict('dependency_exists', 'That dependency already exists');
      throw err;
    }
  }

  async remove({ blockerId, blockedId }: DependencyEdge) {
    const rows = await this.db
      .delete(taskDependencies)
      .where(
        and(eq(taskDependencies.blockerId, blockerId), eq(taskDependencies.blockedId, blockedId)),
      )
      .returning({ blockerId: taskDependencies.blockerId });
    return rows.length > 0;
  }

  async isReachable(fromTaskId: string, toTaskId: string) {
    // The executor type is driver-agnostic; postgres-js returns raw-query rows as an array.
    const rows = (await this.db.execute(sql`
      with recursive reachable(id) as (
        select ${fromTaskId}::uuid
        union
        select d.blocked_id from ${taskDependencies} d join reachable r on d.blocker_id = r.id
      )
      select 1 as found from reachable where id = ${toTaskId}::uuid limit 1
    `)) as unknown as unknown[];
    return rows.length > 0;
  }

  async forTask(taskId: string) {
    const [blockedBy, blocking] = await Promise.all([
      this.refs()
        .innerJoin(taskDependencies, eq(taskDependencies.blockerId, tasks.id))
        .where(eq(taskDependencies.blockedId, taskId)),
      this.refs()
        .innerJoin(taskDependencies, eq(taskDependencies.blockedId, tasks.id))
        .where(eq(taskDependencies.blockerId, taskId)),
    ]);
    return { blockedBy: blockedBy.map(toRef), blocking: blocking.map(toRef) };
  }

  async openBlockers(taskId: string) {
    return (await this.forTask(taskId)).blockedBy.filter((t) => !t.closed);
  }

  async projectGraph(projectId: string): Promise<{ nodes: GraphNode[]; edges: DependencyEdge[] }> {
    const inProject = sql`select id from ${tasks} where project_id = ${projectId}`;
    const edges = await this.db
      .select({ blockerId: taskDependencies.blockerId, blockedId: taskDependencies.blockedId })
      .from(taskDependencies)
      .where(
        or(
          sql`${taskDependencies.blockerId} in (${inProject})`,
          sql`${taskDependencies.blockedId} in (${inProject})`,
        ),
      );

    const linkedIds = [...new Set(edges.flatMap((e) => [e.blockerId, e.blockedId]))];
    const rows = await this.refs().where(
      linkedIds.length
        ? or(eq(tasks.projectId, projectId), inArray(tasks.id, linkedIds))
        : eq(tasks.projectId, projectId),
    );
    const nodes = rows.map((r) => ({
      ...toRef(r),
      estimate: r.estimate,
      external: r.projectId !== projectId,
    }));
    return { nodes, edges };
  }
}

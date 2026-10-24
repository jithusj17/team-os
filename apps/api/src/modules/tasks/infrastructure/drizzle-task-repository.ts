import { and, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { projects, taskLabels, tasks } from '../../../infrastructure/db/schema.js';
import { validation } from '../../../shared/domain/errors.js';
import type { Label } from '../domain/label.js';
import type { TaskPage, TaskRepository } from '../domain/ports.js';
import {
  formatTaskKey,
  priorityToRank,
  rankToPriority,
  type Task,
  type TaskFilter,
  type TaskSort,
  type TaskView,
} from '../domain/task.js';

const taskColumns = {
  id: tasks.id,
  workspaceId: tasks.workspaceId,
  projectId: tasks.projectId,
  number: tasks.number,
  title: tasks.title,
  description: tasks.description,
  statusId: tasks.statusId,
  priority: tasks.priority,
  assigneeId: tasks.assigneeId,
  dueDate: tasks.dueDate,
  estimate: tasks.estimate,
  parentId: tasks.parentId,
  sortOrder: tasks.sortOrder,
  version: tasks.version,
  createdBy: tasks.createdBy,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
  completedAt: tasks.completedAt,
};

const viewColumns = {
  ...taskColumns,
  projectKey: projects.key,
  labels: sql<Label[]>`coalesce((
    select json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color) order by l.name)
    from task_labels tl join labels l on l.id = tl.label_id
    where tl.task_id = ${tasks.id}
  ), '[]'::json)`,
  subtaskCount: sql<number>`(select count(*)::int from tasks st where st.parent_id = ${tasks.id})`,
  openBlockerCount: sql<number>`(
    select count(*)::int from task_dependencies d
    join tasks b on b.id = d.blocker_id
    join project_statuses bs on bs.id = b.status_id
    where d.blocked_id = ${tasks.id} and bs.category not in ('done', 'canceled')
  )`,
};

type TaskRow = Omit<Task, 'priority'> & { priority: number };
type ViewRow = TaskRow & {
  projectKey: string;
  labels: Label[];
  subtaskCount: number;
  openBlockerCount: number;
};

const toTask = (row: TaskRow): Task => ({ ...row, priority: rankToPriority(row.priority) });
const toView = ({ projectKey, ...row }: ViewRow): TaskView => ({
  ...toTask(row),
  key: formatTaskKey(projectKey, row.number),
  labels: row.labels,
  subtaskCount: row.subtaskCount,
  openBlockerCount: row.openBlockerCount,
});

/** Keyset pagination: each sort is a total order over (expression, id). */
const sorts: Record<TaskSort, { expr: SQL; dir: 'asc' | 'desc'; cast: string }> = {
  position: { expr: sql`${tasks.sortOrder}`, dir: 'asc', cast: 'float8' },
  created: { expr: sql`${tasks.createdAt}`, dir: 'desc', cast: 'timestamptz' },
  updated: { expr: sql`${tasks.updatedAt}`, dir: 'desc', cast: 'timestamptz' },
  priority: { expr: sql`${tasks.priority}`, dir: 'desc', cast: 'int2' },
  due: { expr: sql`coalesce(${tasks.dueDate}, '9999-12-31'::date)`, dir: 'asc', cast: 'date' },
};

// Cursors carry the sort value as Postgres text so timestamps keep microsecond precision.
const encodeCursor = (value: string, id: string) =>
  Buffer.from(JSON.stringify([value, id])).toString('base64url');

function decodeCursor(cursor: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      /^[0-9a-f-]{36}$/i.test(parsed[1])
    ) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // fall through
  }
  throw validation('invalid_cursor', 'Invalid pagination cursor');
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function filterConditions(projectId: string, f: TaskFilter): SQL[] {
  const conds: SQL[] = [eq(tasks.projectId, projectId)];
  if (f.statusIds?.length) conds.push(inArray(tasks.statusId, f.statusIds));
  if (f.assigneeIds?.length) {
    const ids = f.assigneeIds.filter((a): a is string => a !== null);
    const parts: SQL[] = [];
    if (ids.length) parts.push(inArray(tasks.assigneeId, ids));
    if (f.assigneeIds.includes(null)) parts.push(isNull(tasks.assigneeId));
    conds.push(or(...parts)!);
  }
  if (f.labelIds?.length) {
    conds.push(
      sql`exists (select 1 from ${taskLabels} where ${taskLabels.taskId} = ${tasks.id} and ${inArray(taskLabels.labelId, f.labelIds)})`,
    );
  }
  if (f.priorities?.length) conds.push(inArray(tasks.priority, f.priorities.map(priorityToRank)));
  if (f.parent === 'none') conds.push(isNull(tasks.parentId));
  else if (f.parent) conds.push(eq(tasks.parentId, f.parent));
  if (f.search) conds.push(ilike(tasks.title, `%${escapeLike(f.search)}%`));
  return conds;
}

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly db: DbExecutor) {}

  private views() {
    return this.db
      .select(viewColumns)
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId));
  }

  async findById(id: string) {
    const [row] = await this.db.select(taskColumns).from(tasks).where(eq(tasks.id, id));
    return row ? toTask(row) : null;
  }

  async findView(id: string) {
    const [row] = await this.views().where(eq(tasks.id, id));
    return row ? toView(row) : null;
  }

  async findViewByNumber(projectId: string, number: number) {
    const [row] = await this.views().where(
      and(eq(tasks.projectId, projectId), eq(tasks.number, number)),
    );
    return row ? toView(row) : null;
  }

  async list(
    projectId: string,
    filter: TaskFilter,
    sort: TaskSort,
    page: { cursor?: string; limit: number },
  ): Promise<TaskPage> {
    const { expr, dir, cast } = sorts[sort];
    const conds = filterConditions(projectId, filter);
    if (page.cursor) {
      const [value, id] = decodeCursor(page.cursor);
      const op = sql.raw(dir === 'asc' ? '>' : '<');
      conds.push(sql`(${expr}, ${tasks.id}) ${op} (${value}::${sql.raw(cast)}, ${id}::uuid)`);
    }
    const order = sql.raw(dir);
    const rows = await this.db
      .select({ ...viewColumns, sortKey: sql<string>`(${expr})::text` })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(...conds))
      .orderBy(sql`${expr} ${order}`, sql`${tasks.id} ${order}`)
      .limit(page.limit + 1);

    const hasMore = rows.length > page.limit;
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return {
      items: items.map(({ sortKey: _k, ...row }) => toView(row)),
      nextCursor: hasMore && last ? encodeCursor(last.sortKey, last.id) : null,
    };
  }

  async create(data: Omit<Task, 'id' | 'version' | 'createdAt' | 'updatedAt'>) {
    const [row] = await this.db
      .insert(tasks)
      .values({ ...data, priority: priorityToRank(data.priority) })
      .returning(taskColumns);
    return toTask(row!);
  }

  async updateIfVersion(
    id: string,
    expectedVersion: number,
    patch: Partial<Omit<Task, 'id' | 'version' | 'createdAt' | 'updatedAt'>>,
  ) {
    const { priority, ...rest } = patch;
    const [row] = await this.db
      .update(tasks)
      .set({
        ...rest,
        ...(priority !== undefined && { priority: priorityToRank(priority) }),
        version: sql`${tasks.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, id), eq(tasks.version, expectedVersion)))
      .returning(taskColumns);
    return row ? toTask(row) : null;
  }

  async delete(id: string) {
    await this.db.delete(tasks).where(eq(tasks.id, id));
  }

  async labelIds(taskId: string) {
    const rows = await this.db
      .select({ labelId: taskLabels.labelId })
      .from(taskLabels)
      .where(eq(taskLabels.taskId, taskId));
    return rows.map((r) => r.labelId);
  }

  async setLabels(taskId: string, labelIds: string[]) {
    await this.db.delete(taskLabels).where(eq(taskLabels.taskId, taskId));
    if (labelIds.length) {
      await this.db.insert(taskLabels).values(labelIds.map((labelId) => ({ taskId, labelId })));
    }
  }

  async positions(taskIds: string[]) {
    if (taskIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        statusId: tasks.statusId,
        sortOrder: tasks.sortOrder,
      })
      .from(tasks)
      .where(inArray(tasks.id, taskIds));
    return new Map(rows.map(({ id, ...pos }) => [id, pos]));
  }

  async maxSortOrder(projectId: string, statusId: string) {
    const [row] = await this.db
      .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.statusId, statusId)));
    return row?.max ?? null;
  }

  async rebalance(projectId: string, statusId: string) {
    await this.db.execute(sql`
      update ${tasks} set sort_order = r.rn * 1024
      from (
        select id, row_number() over (order by sort_order, id) as rn
        from ${tasks} where project_id = ${projectId} and status_id = ${statusId}
      ) r
      where ${tasks.id} = r.id
    `);
  }

  async ancestorIds(taskId: string) {
    // UNION (not UNION ALL) also guards against looping on any corrupt cycle.
    // The executor type is driver-agnostic; postgres-js returns raw-query rows as an array.
    const rows = (await this.db.execute(sql`
      with recursive ancestors(id) as (
        select parent_id from ${tasks} where id = ${taskId} and parent_id is not null
        union
        select t.parent_id from ${tasks} t join ancestors a on t.id = a.id where t.parent_id is not null
      )
      select id from ancestors
    `)) as unknown as { id: string }[];
    return rows.map((r) => r.id);
  }
}

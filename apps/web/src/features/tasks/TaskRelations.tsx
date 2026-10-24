import { Lock, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { DependencyTask, ProjectDetail, Task } from '@team-os/shared';
import { StatusIcon } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { Picker } from '../../components/ui/picker';
import { cn } from '../../lib/cn';
import { useCreateTask, useDependencies, useDependencyMutations } from './hooks';

function RelationRow({
  task,
  statusColor,
  onOpen,
  onRemove,
}: {
  task: Pick<DependencyTask, 'id' | 'key' | 'title' | 'statusCategory' | 'closed'>;
  statusColor: string;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="group flex h-8 items-center gap-2 rounded-md px-1.5 hover:bg-hover">
      <StatusIcon category={task.statusCategory} color={statusColor} />
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="font-mono text-[11px] text-fg-subtle">{task.key}</span>
        <span className={cn('truncate text-[13px]', task.closed && 'text-fg-muted line-through')}>
          {task.title}
        </span>
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${task.key}`}
          className="rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

const colorFor = (project: ProjectDetail, category: DependencyTask['statusCategory']) =>
  project.statuses.find((s) => s.category === category)?.color ?? '#9ca3af';

export function DependenciesSection({
  task,
  project,
  projectTasks,
  canEdit,
  onOpen,
}: {
  task: Task;
  project: ProjectDetail;
  projectTasks: Task[];
  canEdit: boolean;
  onOpen: (id: string) => void;
}) {
  const deps = useDependencies(task.id);
  const { add, remove } = useDependencyMutations(task.id);
  const linked = new Set([task.id, ...(deps.data?.blockedBy ?? []).map((t) => t.id)]);
  const candidates = projectTasks.filter((t) => !linked.has(t.id));

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">
          Dependencies
        </h3>
        {canEdit && (
          <Picker
            value={null}
            onChange={(id) => add.mutate(id)}
            placeholder="Find a blocking task…"
            align="end"
            options={candidates.map((t) => ({ value: t.id, label: `${t.key} ${t.title}` }))}
            trigger={
              <Button variant="ghost" size="sm">
                <Plus className="size-3.5" /> Blocked by
              </Button>
            }
          />
        )}
      </div>
      {deps.data && deps.data.blockedBy.length + deps.data.blocking.length === 0 && (
        <p className="px-1.5 text-[13px] text-fg-subtle">No dependencies.</p>
      )}
      {!!deps.data?.blockedBy.length && (
        <div className="mb-2">
          <div className="flex items-center gap-1 px-1.5 text-[11px] font-medium text-fg-muted">
            <Lock className="size-3" /> Blocked by
          </div>
          {deps.data.blockedBy.map((t) => (
            <RelationRow
              key={t.id}
              task={t}
              statusColor={colorFor(project, t.statusCategory)}
              onOpen={() => onOpen(t.id)}
              onRemove={canEdit ? () => remove.mutate(t.id) : undefined}
            />
          ))}
        </div>
      )}
      {!!deps.data?.blocking.length && (
        <div>
          <div className="px-1.5 text-[11px] font-medium text-fg-muted">Blocking</div>
          {deps.data.blocking.map((t) => (
            <RelationRow
              key={t.id}
              task={t}
              statusColor={colorFor(project, t.statusCategory)}
              onOpen={() => onOpen(t.id)}
            />
          ))}
        </div>
      )}
      {!!deps.data?.hiddenCount && (
        <p className="mt-1 px-1.5 text-[12px] text-fg-subtle">
          +{deps.data.hiddenCount} in projects you can’t see
        </p>
      )}
    </section>
  );
}

export function SubtasksSection({
  task,
  project,
  projectTasks,
  canEdit,
  onOpen,
}: {
  task: Task;
  project: ProjectDetail;
  projectTasks: Task[];
  canEdit: boolean;
  onOpen: (id: string) => void;
}) {
  const create = useCreateTask(project.id);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const subtasks = projectTasks
    .filter((t) => t.parentId === task.id)
    .sort((a, b) => a.number - b.number);
  const statusOf = (t: Task) => project.statuses.find((s) => s.id === t.statusId);
  const done = subtasks.filter((t) =>
    ['done', 'canceled'].includes(statusOf(t)?.category ?? ''),
  ).length;

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">
          Subtasks{' '}
          {subtasks.length > 0 && (
            <span className="font-normal normal-case">
              · {done}/{subtasks.length}
            </span>
          )}
        </h3>
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add
          </Button>
        )}
      </div>
      {subtasks.length > 0 && (
        <div className="mb-1 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-success transition-[width]"
            style={{ width: `${(done / subtasks.length) * 100}%` }}
          />
        </div>
      )}
      {subtasks.map((t) => {
        const s = statusOf(t);
        return (
          <RelationRow
            key={t.id}
            task={{
              ...t,
              statusCategory: s?.category ?? 'todo',
              closed: s?.category === 'done' || s?.category === 'canceled',
            }}
            statusColor={s?.color ?? '#9ca3af'}
            onOpen={() => onOpen(t.id)}
          />
        );
      })}
      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate({ title: title.trim(), parentId: task.id });
            setTitle('');
          }}
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => !title && setAdding(false)}
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            placeholder="Subtask title, then Enter"
            className="h-8 w-full rounded-md border border-accent bg-surface px-2 text-[13px] outline-none"
          />
        </form>
      )}
      {subtasks.length === 0 && !adding && (
        <p className="px-1.5 text-[13px] text-fg-subtle">No subtasks.</p>
      )}
    </section>
  );
}

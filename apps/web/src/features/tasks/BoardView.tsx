import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProjectDetail, ProjectMember, Task } from '@team-os/shared';
import { StatusIcon } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { useLabels } from '../workspaces/hooks';
import { useCreateTask, useUpdateTask } from './hooks';
import { TaskCard } from './TaskCard';

const GAP = 1024;

/** Where a dropped card lands: its neighbours in the target column, and an optimistic sortOrder. */
function placement(column: Task[], index: number) {
  const after = column[index - 1] ?? null;
  const before = column[index] ?? null;
  const sortOrder =
    after && before
      ? (after.sortOrder + before.sortOrder) / 2
      : after
        ? after.sortOrder + GAP
        : before
          ? before.sortOrder - GAP
          : 0;
  return { afterTaskId: after?.id ?? null, beforeTaskId: before?.id ?? null, sortOrder };
}

function SortableCard(
  props: React.ComponentProps<typeof TaskCard> & { id: string; disabled: boolean },
) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
    disabled: props.disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <TaskCard {...props} dragging={isDragging} />
    </div>
  );
}

function QuickAdd({
  projectId,
  statusId,
  onDone,
}: {
  projectId: string;
  statusId: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const create = useCreateTask(projectId);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return onDone();
        create.mutate({ title: title.trim(), statusId });
        setTitle('');
      }}
      className="rounded-lg border border-accent bg-surface p-2 shadow-card"
    >
      <textarea
        autoFocus
        rows={2}
        value={title}
        placeholder="Task title, then Enter"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
          if (e.key === 'Escape') onDone();
        }}
        onBlur={() => !title.trim() && onDone()}
        className="w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
      />
    </form>
  );
}

function Column({
  project,
  status,
  tasks,
  people,
  canEdit,
  onOpen,
}: {
  project: ProjectDetail;
  status: ProjectDetail['statuses'][number];
  tasks: Task[];
  people: Map<string, ProjectMember>;
  canEdit: boolean;
  onOpen: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status.id}` });
  const labels = useLabels();
  const labelMap = new Map((labels.data ?? []).map((l) => [l.id, l]));
  const [adding, setAdding] = useState(false);
  const closed = status.category === 'done' || status.category === 'canceled';

  return (
    <section className="flex w-[280px] shrink-0 flex-col">
      <header className="flex h-9 items-center gap-2 px-1">
        <StatusIcon category={status.category} color={status.color} />
        <span className="text-[13px] font-medium">{status.name}</span>
        <span className="text-[12px] text-fg-subtle">{tasks.length}</span>
        <span className="flex-1" />
        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={`Add task to ${status.name}`}
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3.5" />
          </Button>
        )}
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-xl p-1 pb-4 transition-colors',
          isOver && 'bg-accent-soft/60',
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <SortableCard
              key={t.id}
              id={t.id}
              disabled={!canEdit}
              task={t}
              person={t.assigneeId ? people.get(t.assigneeId) : undefined}
              labels={t.labels.map((l) => labelMap.get(l.id) ?? l)}
              closed={closed}
              onOpen={() => onOpen(t)}
            />
          ))}
        </SortableContext>
        {adding ? (
          <QuickAdd projectId={project.id} statusId={status.id} onDone={() => setAdding(false)} />
        ) : (
          canEdit &&
          tasks.length === 0 && (
            <button
              onClick={() => setAdding(true)}
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-[12px] text-fg-subtle hover:border-border-strong hover:text-fg-muted"
            >
              <Plus className="size-3.5" /> Add task
            </button>
          )
        )}
      </div>
    </section>
  );
}

export function BoardView({
  project,
  tasks,
  people,
  canEdit,
  onOpen,
}: {
  project: ProjectDetail;
  tasks: Task[];
  people: Map<string, ProjectMember>;
  canEdit: boolean;
  onOpen: (t: Task) => void;
}) {
  const update = useUpdateTask();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    // A small distance threshold keeps plain clicks opening the task instead of dragging.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columns = useMemo(() => {
    const byStatus = new Map(project.statuses.map((s) => [s.id, [] as Task[]]));
    for (const t of tasks) byStatus.get(t.statusId)?.push(t);
    for (const list of byStatus.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return byStatus;
  }, [project.statuses, tasks]);

  const active = activeId ? tasks.find((t) => t.id === activeId) : null;
  const labels = useLabels();

  function onDragEnd({ active: dragged, over }: DragEndEvent) {
    setActiveId(null);
    if (!over) return;
    const task = tasks.find((t) => t.id === dragged.id);
    if (!task) return;

    const overId = String(over.id);
    const overTask = tasks.find((t) => t.id === overId);
    const statusId = overId.startsWith('column:') ? overId.slice(7) : overTask?.statusId;
    if (!statusId) return;

    const column = (columns.get(statusId) ?? []).filter((t) => t.id !== task.id);
    let index = column.length;
    if (overTask && overTask.id !== task.id) {
      index = column.findIndex((t) => t.id === overTask.id);
      // Dragging downward within a column lands below the hovered card.
      const original = columns.get(statusId) ?? [];
      if (task.statusId === statusId && original.indexOf(task) < original.indexOf(overTask))
        index += 1;
    } else if (overTask?.id === task.id) {
      return; // dropped on itself
    }

    const { afterTaskId, beforeTaskId, sortOrder } = placement(column, index);
    if (task.statusId === statusId && sortOrder === task.sortOrder) return;
    update.mutate({
      id: task.id,
      projectId: project.id,
      version: task.version,
      changes: {
        ...(statusId !== task.statusId && { statusId }),
        position: { afterTaskId, beforeTaskId },
      },
      optimistic: { statusId, sortOrder },
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={({ active: a }: DragStartEvent) => setActiveId(String(a.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="flex h-full gap-3 overflow-x-auto px-5 pt-3 pb-2">
        {project.statuses.map((status) => (
          <Column
            key={status.id}
            project={project}
            status={status}
            tasks={columns.get(status.id) ?? []}
            people={people}
            canEdit={canEdit}
            onOpen={onOpen}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease-out' }}>
        {active && (
          <TaskCard
            overlay
            task={active}
            person={active.assigneeId ? people.get(active.assigneeId) : undefined}
            labels={active.labels.map((l) => labels.data?.find((x) => x.id === l.id) ?? l)}
            closed={false}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

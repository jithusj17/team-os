import { ChevronRight, OctagonAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProjectDetail, ProjectMember, Task } from '@team-os/shared';
import { StatusIcon } from '../../components/icons';
import { cn } from '../../lib/cn';
import { useLabels } from '../workspaces/hooks';
import { AssigneePicker, DueDate, LabelChip, PriorityPicker, StatusPicker } from './fields';
import { useUpdateTask } from './hooks';

export function ListView({
  project,
  tasks,
  people,
  canEdit,
  onOpen,
}: {
  project: ProjectDetail;
  tasks: Task[];
  people: ProjectMember[];
  canEdit: boolean;
  onOpen: (t: Task) => void;
}) {
  const update = useUpdateTask();
  const labels = useLabels();
  const labelMap = new Map((labels.data ?? []).map((l) => [l.id, l]));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () =>
      project.statuses.map((status) => ({
        status,
        tasks: tasks
          .filter((t) => t.statusId === status.id)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      })),
    [project.statuses, tasks],
  );

  const change = (t: Task, changes: Parameters<typeof update.mutate>[0]['changes']) =>
    update.mutate({ id: t.id, projectId: t.projectId, version: t.version, changes });

  return (
    <div className="h-full overflow-y-auto pb-10">
      {groups.map(({ status, tasks: groupTasks }) => {
        const isCollapsed = collapsed.has(status.id);
        const closed = status.category === 'done' || status.category === 'canceled';
        return (
          <section key={status.id}>
            <button
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(status.id)) next.delete(status.id);
                  else next.add(status.id);
                  return next;
                })
              }
              className="sticky top-0 z-10 flex h-9 w-full items-center gap-2 border-b border-border bg-muted/80 px-5 text-left backdrop-blur"
            >
              <ChevronRight
                className={cn(
                  'size-3.5 text-fg-subtle transition-transform',
                  !isCollapsed && 'rotate-90',
                )}
              />
              <StatusIcon category={status.category} color={status.color} />
              <span className="text-[13px] font-medium">{status.name}</span>
              <span className="text-[12px] text-fg-subtle">{groupTasks.length}</span>
            </button>
            {!isCollapsed &&
              groupTasks.map((t) => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(t)}
                  onKeyDown={(e) => e.key === 'Enter' && onOpen(t)}
                  className="group flex h-10 cursor-pointer items-center gap-2 border-b border-border px-4 hover:bg-hover/60"
                >
                  <PriorityPicker
                    compact
                    value={t.priority}
                    disabled={!canEdit}
                    onChange={(priority) => change(t, { priority })}
                  />
                  <span className="w-16 shrink-0 font-mono text-[12px] text-fg-subtle">
                    {t.key}
                  </span>
                  <StatusPicker
                    compact
                    statuses={project.statuses}
                    value={t.statusId}
                    disabled={!canEdit}
                    onChange={(statusId) => change(t, { statusId })}
                  />
                  <span
                    className={cn('min-w-0 flex-1 truncate text-[13px]', closed && 'text-fg-muted')}
                  >
                    {t.title}
                  </span>
                  {t.openBlockerCount > 0 && (
                    <OctagonAlert className="size-3.5 shrink-0 text-danger" aria-label="Blocked" />
                  )}
                  <span className="hidden items-center gap-1 sm:flex">
                    {t.labels.slice(0, 3).map((l) => (
                      <LabelChip key={l.id} label={labelMap.get(l.id) ?? l} />
                    ))}
                  </span>
                  <span className="hidden w-20 justify-end sm:flex">
                    <DueDate task={t} closed={closed} />
                  </span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <AssigneePicker
                      compact
                      people={people}
                      value={t.assigneeId}
                      disabled={!canEdit}
                      onChange={(assigneeId) => change(t, { assigneeId })}
                    />
                  </span>
                </div>
              ))}
          </section>
        );
      })}
    </div>
  );
}

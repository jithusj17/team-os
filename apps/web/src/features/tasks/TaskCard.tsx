import { GitMerge, OctagonAlert } from 'lucide-react';
import type { Label, ProjectMember, Task } from '@team-os/shared';
import { PriorityIcon } from '../../components/icons';
import { Avatar, Tooltip } from '../../components/ui/misc';
import { cn } from '../../lib/cn';
import { DueDate, LabelChip } from './fields';

export function TaskCard({
  task,
  person,
  labels,
  closed,
  onOpen,
  dragging,
  overlay,
}: {
  task: Task;
  person?: ProjectMember;
  labels: Label[];
  closed: boolean;
  onOpen?: () => void;
  dragging?: boolean;
  overlay?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen?.()}
      className={cn(
        'group cursor-pointer rounded-lg border border-border bg-surface p-2.5 text-left shadow-card transition-[border-color,box-shadow]',
        'hover:border-border-strong',
        dragging && 'opacity-40',
        overlay && 'rotate-[1.5deg] cursor-grabbing shadow-pop',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <span className="font-mono">{task.key}</span>
        {task.openBlockerCount > 0 && (
          <Tooltip
            content={`Blocked by ${task.openBlockerCount} open task${task.openBlockerCount > 1 ? 's' : ''}`}
          >
            <span className="inline-flex items-center gap-0.5 text-danger">
              <OctagonAlert className="size-3" />
              Blocked
            </span>
          </Tooltip>
        )}
        <span className="flex-1" />
        <Avatar
          user={
            person ? { id: person.userId, name: person.name, avatarUrl: person.avatarUrl } : null
          }
          size={18}
        />
      </div>
      <div
        className={cn(
          'mt-1 text-[13px] leading-snug font-medium',
          closed && 'text-fg-muted line-through decoration-fg-subtle',
        )}
      >
        {task.title}
      </div>
      {(task.priority !== 'none' || task.dueDate || task.subtaskCount > 0 || labels.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.priority !== 'none' && (
            <span className="inline-flex h-5 items-center rounded-full border border-border px-1">
              <PriorityIcon priority={task.priority} className="scale-90" />
            </span>
          )}
          <DueDate task={task} closed={closed} />
          {task.subtaskCount > 0 && (
            <span className="inline-flex h-5 items-center gap-1 rounded-full border border-border px-1.5 text-[11px] text-fg-muted">
              <GitMerge className="size-3" />
              {task.subtaskCount}
            </span>
          )}
          {labels.map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
        </div>
      )}
    </div>
  );
}

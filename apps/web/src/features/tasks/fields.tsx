import { CalendarDays, Tag, User } from 'lucide-react';
import {
  taskPriorities,
  type Label,
  type ProjectMember,
  type ProjectStatus,
  type Task,
  type TaskPriority,
} from '@team-os/shared';
import { PriorityIcon, StatusIcon, priorityLabels } from '../../components/icons';
import { Avatar } from '../../components/ui/misc';
import { Picker } from '../../components/ui/picker';
import { cn } from '../../lib/cn';
import { dueState, formatDate, parseDay } from '../../lib/format';

// Pickers for task fields, shared by the board, list, task panel and create dialog.

const chip =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-[13px] text-fg transition-colors hover:bg-hover disabled:pointer-events-none';

export function StatusPicker({
  statuses,
  value,
  onChange,
  compact,
  disabled,
}: {
  statuses: ProjectStatus[];
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const current = statuses.find((s) => s.id === value);
  return (
    <Picker
      value={value}
      onChange={onChange}
      options={statuses.map((s) => ({
        value: s.id,
        label: s.name,
        icon: <StatusIcon category={s.category} color={s.color} />,
      }))}
      trigger={
        <button
          type="button"
          disabled={disabled}
          className={chip}
          aria-label="Status"
          onClick={(e) => e.stopPropagation()}
        >
          {current && <StatusIcon category={current.category} color={current.color} />}
          {!compact && <span className="truncate">{current?.name ?? 'Status'}</span>}
        </button>
      }
    />
  );
}

export function PriorityPicker({
  value,
  onChange,
  compact,
  disabled,
}: {
  value: TaskPriority;
  onChange: (p: TaskPriority) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <Picker
      value={value}
      onChange={onChange}
      options={[...taskPriorities].reverse().map((p) => ({
        value: p,
        label: priorityLabels[p],
        icon: <PriorityIcon priority={p} />,
      }))}
      trigger={
        <button
          type="button"
          disabled={disabled}
          className={chip}
          aria-label="Priority"
          onClick={(e) => e.stopPropagation()}
        >
          <PriorityIcon priority={value} />
          {!compact && (
            <span className={cn(value === 'none' && 'text-fg-subtle')}>
              {priorityLabels[value]}
            </span>
          )}
        </button>
      }
    />
  );
}

const UNASSIGNED = '__none__';

export function AssigneePicker({
  people,
  value,
  onChange,
  compact,
  disabled,
}: {
  people: ProjectMember[];
  value: string | null;
  onChange: (userId: string | null) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const current = people.find((p) => p.userId === value);
  return (
    <Picker
      value={value ?? UNASSIGNED}
      onChange={(v) => onChange(v === UNASSIGNED ? null : v)}
      options={[
        {
          value: UNASSIGNED,
          label: 'Unassigned',
          icon: <User className="size-3.5 text-fg-subtle" />,
        },
        ...people.map((p) => ({
          value: p.userId,
          label: p.name,
          keywords: p.email,
          icon: <Avatar user={{ id: p.userId, name: p.name, avatarUrl: p.avatarUrl }} size={16} />,
        })),
      ]}
      placeholder="Assign to…"
      trigger={
        <button
          type="button"
          disabled={disabled}
          className={chip}
          aria-label="Assignee"
          onClick={(e) => e.stopPropagation()}
        >
          <Avatar
            user={
              current
                ? { id: current.userId, name: current.name, avatarUrl: current.avatarUrl }
                : null
            }
            size={18}
          />
          {!compact && (
            <span className={cn('truncate', !current && 'text-fg-subtle')}>
              {current?.name ?? 'Unassigned'}
            </span>
          )}
        </button>
      }
    />
  );
}

export function LabelPicker({
  labels,
  value,
  onChange,
  disabled,
}: {
  labels: Label[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const selected = labels.filter((l) => value.includes(l.id));
  return (
    <Picker
      multiple
      value={value}
      onChange={(id) =>
        onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
      }
      options={labels.map((l) => ({
        value: l.id,
        label: l.name,
        icon: <span className="size-2.5 rounded-full" style={{ background: l.color }} />,
      }))}
      placeholder="Add labels…"
      trigger={
        <button
          type="button"
          disabled={disabled}
          className={cn(chip, 'flex-wrap')}
          aria-label="Labels"
        >
          {selected.length === 0 ? (
            <>
              <Tag className="size-3.5 text-fg-subtle" />
              <span className="text-fg-subtle">
                {labels.length ? 'Add labels' : 'No labels yet'}
              </span>
            </>
          ) : (
            selected.map((l) => <LabelChip key={l.id} label={l} />)
          )}
        </button>
      }
    />
  );
}

export function LabelChip({ label }: { label: Pick<Label, 'name' | 'color'> }) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border border-border bg-surface px-1.5 text-[11px] font-medium text-fg-muted">
      <span className="size-2 rounded-full" style={{ background: label.color }} />
      {label.name}
    </span>
  );
}

export function DueDate({ task, closed }: { task: Pick<Task, 'dueDate'>; closed: boolean }) {
  if (!task.dueDate) return null;
  const state = dueState(task.dueDate, closed);
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full border border-border px-1.5 text-[11px] font-medium',
        state === 'overdue'
          ? 'border-danger/40 text-danger'
          : state === 'soon'
            ? 'text-warning'
            : 'text-fg-muted',
      )}
    >
      <CalendarDays className="size-3" />
      {formatDate(parseDay(task.dueDate))}
    </span>
  );
}

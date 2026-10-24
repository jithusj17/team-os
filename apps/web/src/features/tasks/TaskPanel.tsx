import { Bell, BellOff, Link2, MoreHorizontal, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { canInProject, type ProjectDetail, type ProjectMember, type Task } from '@team-os/shared';
import { Button } from '../../components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu';
import { Avatar, Tooltip } from '../../components/ui/misc';
import { PageSpinner } from '../../components/ui/spinner';
import { cn } from '../../lib/cn';
import { usePresence } from '../../lib/realtime';
import { useCurrentUser } from '../auth/hooks';
import { useLabels, useWorkspaceId } from '../workspaces/hooks';
import { AssigneePicker, LabelPicker, PriorityPicker, StatusPicker } from './fields';
import { useDeleteTask, useTask, useUpdateTask, useWatching, type TaskUpdate } from './hooks';
import { DependenciesSection, SubtasksSection } from './TaskRelations';
import { TaskTimeline } from './TaskTimeline';

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-2">
      <span className="text-[12px] text-fg-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A text field that saves on blur (or Enter, for single-line fields). */
function InlineText({
  value,
  onSave,
  multiline,
  disabled,
  placeholder,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Adopt changes from elsewhere (e.g. a teammate's edit) during render, not in an effect.
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [draft]);

  const commit = () => {
    const next = multiline ? draft : draft.trim();
    if (next !== value && (multiline || next)) onSave(next);
    else setDraft(value);
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (!multiline && e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        'block w-full resize-none overflow-hidden rounded-md bg-transparent px-1.5 py-1 outline-none',
        'placeholder:text-fg-subtle hover:bg-hover/60 focus:bg-surface focus:ring-2 focus:ring-accent/20 disabled:hover:bg-transparent',
        className,
      )}
    />
  );
}

export function TaskPanel({
  taskId,
  project,
  projectTasks,
  people,
  onClose,
  onOpen,
}: {
  taskId: string;
  project: ProjectDetail;
  projectTasks: Task[];
  people: ProjectMember[];
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const me = useCurrentUser();
  const workspaceId = useWorkspaceId();
  const { data: task, isError } = useTask(taskId, project.id);
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const labels = useLabels();
  const { watching, toggle } = useWatching(taskId, me.id);
  const viewers = usePresence(taskId).filter((id) => id !== me.id);
  const peopleMap = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);
  const canEdit = canInProject(project.role, 'task:update');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, [contenteditable]');
      if (
        e.key === 'Escape' &&
        !typing &&
        !document.querySelector('[data-radix-popper-content-wrapper]')
      )
        onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (isError) {
    return (
      <Shell onClose={onClose}>
        <p className="p-6 text-[13px] text-fg-muted">
          This task was deleted or you no longer have access to it.
        </p>
      </Shell>
    );
  }
  if (!task) {
    return (
      <Shell onClose={onClose}>
        <PageSpinner />
      </Shell>
    );
  }

  const change = (changes: TaskUpdate['changes']) =>
    update.mutate({ id: task.id, projectId: task.projectId, version: task.version, changes });
  const parent = task.parentId ? projectTasks.find((t) => t.id === task.parentId) : null;

  return (
    <Shell onClose={onClose}>
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-4">
        <span className="font-mono text-[12px] text-fg-muted">{task.key}</span>
        {parent && (
          <button
            onClick={() => onOpen(parent.id)}
            className="ml-1 truncate text-[12px] text-fg-subtle hover:text-fg"
          >
            · in {parent.key}
          </button>
        )}
        <span className="flex-1" />
        {viewers.length > 0 && (
          <Tooltip
            content={`Also viewing: ${viewers.map((id) => peopleMap.get(id)?.name ?? 'someone').join(', ')}`}
          >
            <span className="mr-2 flex -space-x-1.5">
              {viewers.slice(0, 4).map((id) => {
                const p = peopleMap.get(id);
                return (
                  <Avatar
                    key={id}
                    user={p ? { id, name: p.name, avatarUrl: p.avatarUrl } : { id, name: '?' }}
                    size={22}
                    className="ring-2 ring-raised"
                  />
                );
              })}
            </span>
          </Tooltip>
        )}
        <Tooltip content={watching ? 'Stop watching' : 'Watch for updates'}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle watching"
            onClick={() => toggle.mutate(!watching)}
          >
            {watching ? <Bell className="size-4 text-accent" /> : <BellOff className="size-4" />}
          </Button>
        </Tooltip>
        <Tooltip content="Copy link">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Copy link"
            onClick={() => {
              void navigator.clipboard.writeText(
                `${window.location.origin}/w/${workspaceId}/tasks/${task.key}`,
              );
              toast.success('Link copied');
            }}
          >
            <Link2 className="size-4" />
          </Button>
        </Tooltip>
        {canInProject(project.role, 'task:delete') && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem
                danger
                icon={<Trash2 className="size-3.5" />}
                onSelect={() => {
                  if (confirm(`Delete ${task.key}? This can't be undone.`)) {
                    remove.mutate(task, { onSuccess: onClose });
                  }
                }}
              >
                Delete task
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div className="-mx-1.5">
          <InlineText
            value={task.title}
            disabled={!canEdit}
            onSave={(title) => change({ title })}
            className="text-[18px] leading-snug font-semibold"
          />
        </div>

        <div className="space-y-1">
          <Property label="Status">
            <StatusPicker
              statuses={project.statuses}
              value={task.statusId}
              disabled={!canEdit}
              onChange={(statusId) => change({ statusId })}
            />
          </Property>
          <Property label="Priority">
            <PriorityPicker
              value={task.priority}
              disabled={!canEdit}
              onChange={(priority) => change({ priority })}
            />
          </Property>
          <Property label="Assignee">
            <AssigneePicker
              people={people}
              value={task.assigneeId}
              disabled={!canEdit}
              onChange={(assigneeId) => change({ assigneeId })}
            />
          </Property>
          <Property label="Labels">
            <LabelPicker
              labels={labels.data ?? []}
              value={task.labels.map((l) => l.id)}
              disabled={!canEdit}
              onChange={(labelIds) => change({ labelIds })}
            />
          </Property>
          <Property label="Due date">
            <input
              type="date"
              value={task.dueDate ?? ''}
              disabled={!canEdit}
              onChange={(e) => change({ dueDate: e.target.value || null })}
              className="h-7 rounded-md bg-transparent px-1.5 text-[13px] text-fg outline-none hover:bg-hover focus:bg-surface [&::-webkit-calendar-picker-indicator]:opacity-50"
            />
          </Property>
          <Property label="Estimate">
            <input
              type="number"
              min={0}
              max={1000}
              value={task.estimate ?? ''}
              disabled={!canEdit}
              placeholder="Points"
              onChange={(e) => {
                const n = e.target.value === '' ? null : Number(e.target.value);
                if (n === null || (Number.isInteger(n) && n >= 0)) change({ estimate: n });
              }}
              className="h-7 w-24 rounded-md bg-transparent px-1.5 text-[13px] outline-none placeholder:text-fg-subtle hover:bg-hover focus:bg-surface"
            />
          </Property>
        </div>

        <div className="-mx-1.5">
          <InlineText
            multiline
            value={task.description}
            disabled={!canEdit}
            placeholder={canEdit ? 'Add a description…' : 'No description'}
            onSave={(description) => change({ description })}
            className="min-h-16 text-[13px] leading-relaxed"
          />
        </div>

        <SubtasksSection
          task={task}
          project={project}
          projectTasks={projectTasks}
          canEdit={canEdit}
          onOpen={onOpen}
        />
        <DependenciesSection
          task={task}
          project={project}
          projectTasks={projectTasks}
          canEdit={canEdit}
          onOpen={onOpen}
        />
        <TaskTimeline taskId={task.id} project={project} people={people} currentUserId={me.id} />
      </div>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/10 md:hidden" onClick={onClose} />
      <aside
        role="dialog"
        aria-label="Task details"
        className="animate-slide-in fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-border bg-raised shadow-pop sm:w-[540px]"
      >
        {children}
      </aside>
    </>
  );
}

import {
  Columns3,
  Globe,
  List,
  Lock,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Wand2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { canInProject, taskPriorities, type Task, type TaskPriority } from '@team-os/shared';
import { PriorityIcon, priorityLabels } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { Avatar, EmptyState, Kbd, Tooltip } from '../../components/ui/misc';
import { Picker } from '../../components/ui/picker';
import { PageSpinner } from '../../components/ui/spinner';
import { cn } from '../../lib/cn';
import { useProjectSubscription } from '../../lib/realtime';
import { useCurrentUser } from '../auth/hooks';
import { BoardView } from '../tasks/BoardView';
import { ActionsDialog } from '../ai/ActionsDialog';
import { SummarizeButton, SummaryCard } from '../ai/components';
import { useAiEnabled, useSummary } from '../ai/hooks';
import { CreateTaskDialog } from '../tasks/CreateTaskDialog';
import { useProjectTasks } from '../tasks/hooks';
import { ListView } from '../tasks/ListView';
import { TaskPanel } from '../tasks/TaskPanel';
import { useLabels, useWorkspaceId } from '../workspaces/hooks';
import { useProject, useProjectPeople } from './hooks';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';

type View = 'board' | 'list';

interface Filters {
  search: string;
  assignees: string[]; // user ids, or 'none'
  priorities: TaskPriority[];
  labels: string[];
}

const emptyFilters: Filters = { search: '', assignees: [], priorities: [], labels: [] };

function applyFilters(tasks: Task[], f: Filters) {
  const q = f.search.trim().toLowerCase();
  return tasks.filter(
    (t) =>
      (!q || t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q)) &&
      (!f.assignees.length || f.assignees.includes(t.assigneeId ?? 'none')) &&
      (!f.priorities.length || f.priorities.includes(t.priority)) &&
      (!f.labels.length || t.labels.some((l) => f.labels.includes(l.id))),
  );
}

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const me = useCurrentUser();
  const project = useProject(projectId);
  const tasks = useProjectTasks(projectId);
  const people = useProjectPeople(projectId);
  const labels = useLabels();
  useProjectSubscription(projectId);

  const view: View = params.get('view') === 'list' ? 'list' : 'board';
  const openTaskId = params.get('task');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiActionsOpen, setAiActionsOpen] = useState(false);
  const workspaceId = useWorkspaceId();
  const aiEnabled = useAiEnabled();
  const statusUpdate = useSummary('project', projectId);

  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: key === 'view' },
      ),
    [setParams],
  );
  const openTask = useCallback((id: string) => setParam('task', id), [setParam]);
  const closeTask = useCallback(() => setParam('task', null), [setParam]);

  const canCreate = project.data ? canInProject(project.data.role, 'task:create') : false;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest(
        'input, textarea, [contenteditable], [role=dialog]',
      );
      if (!typing && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'c' && canCreate) {
        e.preventDefault();
        setCreating(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCreate]);

  const peopleList = useMemo(() => people.data ?? [], [people.data]);
  const peopleMap = useMemo(() => new Map(peopleList.map((p) => [p.userId, p])), [peopleList]);
  const visible = useMemo(() => applyFilters(tasks.data ?? [], filters), [tasks.data, filters]);
  const filterCount = filters.assignees.length + filters.priorities.length + filters.labels.length;

  if (project.isError) {
    return (
      <EmptyState
        icon={<Lock className="size-5" />}
        title="Project not found"
        description="It may have been deleted, or you don't have access."
      />
    );
  }
  if (!project.data || !tasks.data) return <PageSpinner />;
  const p = project.data;

  const toggle = <T extends string>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-[10px] font-bold text-accent">
          {p.key.slice(0, 3)}
        </span>
        <h1 className="text-[15px] font-semibold">{p.name}</h1>
        <Tooltip
          content={
            p.visibility === 'private'
              ? 'Private: only members can see it'
              : 'Visible to the workspace'
          }
        >
          <span className="text-fg-subtle">
            {p.visibility === 'private' ? (
              <Lock className="size-3.5" />
            ) : (
              <Globe className="size-3.5" />
            )}
          </span>
        </Tooltip>

        <div className="ml-3 flex rounded-lg border border-border bg-muted p-0.5">
          {(
            [
              ['board', Columns3, 'Board'],
              ['list', List, 'List'],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              onClick={() => setParam('view', value === 'board' ? null : value)}
              className={cn(
                'flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors',
                view === value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        <span className="flex-1" />

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Filter tasks"
            className="h-7 w-36 rounded-md border border-border bg-surface pr-2 pl-7 text-[13px] outline-none placeholder:text-fg-subtle focus:w-48 focus:border-accent sm:w-44"
          />
        </div>

        <Picker
          multiple
          value={filters.assignees}
          onChange={(v) => setFilters((f) => ({ ...f, assignees: toggle(f.assignees, v) }))}
          options={[
            { value: me.id, label: 'Me', icon: <Avatar user={me} size={16} /> },
            { value: 'none', label: 'Unassigned', icon: <Avatar user={null} size={16} /> },
            ...peopleList
              .filter((x) => x.userId !== me.id)
              .map((x) => ({
                value: x.userId,
                label: x.name,
                icon: (
                  <Avatar user={{ id: x.userId, name: x.name, avatarUrl: x.avatarUrl }} size={16} />
                ),
              })),
          ]}
          trigger={
            <Button size="sm" variant={filters.assignees.length ? 'secondary' : 'ghost'}>
              Assignee{filters.assignees.length ? ` · ${filters.assignees.length}` : ''}
            </Button>
          }
        />
        <Picker
          multiple
          value={filters.priorities}
          onChange={(v) => setFilters((f) => ({ ...f, priorities: toggle(f.priorities, v) }))}
          options={[...taskPriorities].reverse().map((x) => ({
            value: x,
            label: priorityLabels[x],
            icon: <PriorityIcon priority={x} />,
          }))}
          trigger={
            <Button size="sm" variant={filters.priorities.length ? 'secondary' : 'ghost'}>
              Priority{filters.priorities.length ? ` · ${filters.priorities.length}` : ''}
            </Button>
          }
        />
        {!!labels.data?.length && (
          <Picker
            multiple
            value={filters.labels}
            onChange={(v) => setFilters((f) => ({ ...f, labels: toggle(f.labels, v) }))}
            options={labels.data.map((l) => ({
              value: l.id,
              label: l.name,
              icon: <span className="size-2.5 rounded-full" style={{ background: l.color }} />,
            }))}
            trigger={
              <Button size="sm" variant={filters.labels.length ? 'secondary' : 'ghost'}>
                <SlidersHorizontal className="size-3.5" /> Labels
                {filters.labels.length ? ` · ${filters.labels.length}` : ''}
              </Button>
            }
          />
        )}
        {(filterCount > 0 || filters.search) && (
          <Button size="sm" variant="ghost" onClick={() => setFilters(emptyFilters)}>
            <X className="size-3.5" /> Clear
          </Button>
        )}

        {aiEnabled && (
          <>
            <SummarizeButton
              label="Status update"
              busy={statusUpdate.status === 'streaming'}
              onClick={statusUpdate.run}
            />
            {(canCreate || canInProject(p.role, 'task:update')) && (
              <Button size="sm" variant="ghost" onClick={() => setAiActionsOpen(true)}>
                <Wand2 className="size-3.5 text-accent" /> AI actions
              </Button>
            )}
          </>
        )}
        {p.role === 'admin' && (
          <Tooltip content="Project settings">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Project settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="size-4" />
            </Button>
          </Tooltip>
        )}
        {canCreate && (
          <Tooltip
            content={
              <span className="flex items-center gap-1">
                New task <Kbd>C</Kbd>
              </span>
            }
          >
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" /> New task
            </Button>
          </Tooltip>
        )}
      </header>

      {statusUpdate.status !== 'idle' && (
        <div className="max-h-[40vh] shrink-0 overflow-y-auto border-b border-border px-5 py-3">
          <SummaryCard
            title="AI status update"
            stream={statusUpdate}
            onClose={statusUpdate.reset}
            className="mx-auto max-w-3xl"
          />
        </div>
      )}

      <div className="min-h-0 flex-1">
        {tasks.data.length === 0 ? (
          <EmptyState
            icon={<Columns3 className="size-5" />}
            title="No tasks yet"
            description="Create the first task for this project. Press C anywhere on this page."
            action={
              canCreate && (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus className="size-3.5" /> New task
                </Button>
              )
            }
          />
        ) : view === 'board' ? (
          <BoardView
            project={p}
            tasks={visible}
            people={peopleMap}
            canEdit={canInProject(p.role, 'task:update')}
            onOpen={(t) => openTask(t.id)}
          />
        ) : (
          <ListView
            project={p}
            tasks={visible}
            people={peopleList}
            canEdit={canInProject(p.role, 'task:update')}
            onOpen={(t) => openTask(t.id)}
          />
        )}
      </div>

      {openTaskId && (
        <TaskPanel
          key={openTaskId}
          taskId={openTaskId}
          project={p}
          projectTasks={tasks.data}
          people={peopleList}
          onClose={closeTask}
          onOpen={openTask}
        />
      )}
      <CreateTaskDialog
        open={creating}
        onOpenChange={setCreating}
        project={p}
        people={peopleList}
        onCreated={openTask}
      />
      {aiEnabled && (
        <ActionsDialog
          open={aiActionsOpen}
          onOpenChange={setAiActionsOpen}
          workspaceId={workspaceId}
          projectId={p.id}
          title={`AI actions in ${p.name}`}
        />
      )}
      {p.role === 'admin' && (
        <ProjectSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} project={p} />
      )}
    </div>
  );
}

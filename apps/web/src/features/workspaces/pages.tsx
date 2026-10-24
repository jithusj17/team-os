import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FolderKanban, Lock, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useNavigate, useParams } from 'react-router';
import { canInWorkspace, task } from '@team-os/shared';
import { Logo } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';
import { EmptyState } from '../../components/ui/misc';
import { PageSpinner } from '../../components/ui/spinner';
import { AppShell } from '../../layouts/AppShell';
import { api, errorMessage } from '../../lib/api';
import { RealtimeProvider } from '../../lib/realtime';
import { CreateProjectDialog } from '../projects/CreateProjectDialog';
import { useProjects } from '../projects/hooks';
import { useCreateWorkspace, useWorkspace, useWorkspaceId, useWorkspaces } from './hooks';

const LAST_WORKSPACE = 'team-os:last-workspace';

function remember(id: string) {
  try {
    localStorage.setItem(LAST_WORKSPACE, id);
  } catch {
    // Not essential: we fall back to the first workspace.
  }
}

/** "/" goes to the last workspace you used, the first one, or onboarding if you have none. */
export function HomeRedirect() {
  const workspaces = useWorkspaces();
  if (!workspaces.data) return <PageSpinner />;
  if (workspaces.data.length === 0) return <Navigate to="/new" replace />;
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_WORKSPACE);
  } catch {
    // ignore
  }
  const target = workspaces.data.find((w) => w.id === last) ?? workspaces.data[0]!;
  return <Navigate to={`/w/${target.id}`} replace />;
}

export function WorkspaceLayout() {
  const workspaceId = useWorkspaceId();
  const workspace = useWorkspace();
  useEffect(() => remember(workspaceId), [workspaceId]);

  if (workspace.isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<Lock className="size-5" />}
          title="Workspace not found"
          description="It may have been deleted, or you're no longer a member."
          action={
            <Link to="/">
              <Button>Go to my workspaces</Button>
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <RealtimeProvider workspaceId={workspaceId}>
      <AppShell>
        <Outlet />
      </AppShell>
    </RealtimeProvider>
  );
}

export function WorkspaceHome() {
  const workspace = useWorkspace();
  const projects = useProjects();
  const workspaceId = useWorkspaceId();
  const [creating, setCreating] = useState(false);
  const canCreate =
    workspace.data && canInWorkspace(workspace.data.role, { action: 'project:create' });

  if (!projects.data || !workspace.data) return <PageSpinner />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-xl font-semibold tracking-tight">{workspace.data.name}</h1>
        <p className="mt-1 text-[13px] text-fg-muted">Your projects</p>

        {projects.data.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border">
            <EmptyState
              icon={<FolderKanban className="size-5" />}
              title="Create your first project"
              description="Projects hold a board of tasks with their own statuses and members."
              action={
                canCreate && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus className="size-3.5" /> New project
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {projects.data.map((p) => (
              <Link
                key={p.id}
                to={`/w/${workspaceId}/p/${p.id}`}
                className="group rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-[11px] font-bold text-accent">
                    {p.key.slice(0, 3)}
                  </span>
                  <span className="flex-1">
                    <span className="block text-[14px] font-medium">{p.name}</span>
                    <span className="block text-[12px] text-fg-subtle">
                      {p.visibility === 'private' ? 'Private' : 'Workspace'} · you’re{' '}
                      {p.role === 'admin' ? 'an admin' : `an ${p.role}`}
                    </span>
                  </span>
                  <ArrowRight className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                </div>
                {p.description && (
                  <p className="mt-3 line-clamp-2 text-[13px] text-fg-muted">{p.description}</p>
                )}
              </Link>
            ))}
            {canCreate && (
              <button
                onClick={() => setCreating(true)}
                className="flex min-h-20 items-center justify-center gap-2 rounded-xl border border-dashed border-border text-[13px] text-fg-muted hover:border-border-strong hover:text-fg"
              >
                <Plus className="size-4" /> New project
              </button>
            )}
          </div>
        )}
      </div>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/** Onboarding: name your first (or another) workspace. */
export function CreateWorkspacePage() {
  const create = useCreateWorkspace();
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const [name, setName] = useState('');

  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Logo className="size-9" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Create a workspace</h1>
        <p className="mt-1.5 text-[14px] text-fg-muted">
          A workspace is where your team’s projects, tasks and docs live.
        </p>
        <form
          className="mt-8 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ws = await create.mutateAsync(name);
            navigate(`/w/${ws.id}`);
          }}
        >
          <Field label="Workspace name" error={create.error ? errorMessage(create.error) : null}>
            <Input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              className="h-10 text-[14px]"
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full justify-center"
            loading={create.isPending}
          >
            Create workspace
          </Button>
          {!!workspaces.data?.length && (
            <Link to="/" className="block text-center text-[13px] text-fg-muted hover:text-fg">
              Back to my workspaces
            </Link>
          )}
        </form>
      </div>
    </div>
  );
}

/** Resolves links like /w/:id/tasks/ENG-12 (from emails and "copy link") to the task. */
export function TaskKeyRedirect() {
  const { workspaceId = '', taskKey = '' } = useParams();
  const found = useQuery({
    queryKey: ['task-by-key', workspaceId, taskKey],
    queryFn: () =>
      api(`/workspaces/${workspaceId}/tasks/by-key/${encodeURIComponent(taskKey)}`, task),
    retry: false,
  });
  if (found.isError) {
    return (
      <EmptyState
        icon={<Lock className="size-5" />}
        title={`${taskKey} not found`}
        description="It may have been deleted, or you don't have access."
      />
    );
  }
  if (!found.data) return <PageSpinner />;
  return (
    <Navigate to={`/w/${workspaceId}/p/${found.data.projectId}?task=${found.data.id}`} replace />
  );
}

import { FileText, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { canInWorkspace } from '@team-os/shared';
import { Button } from '../../components/ui/button';
import { Avatar, EmptyState } from '../../components/ui/misc';
import { Picker } from '../../components/ui/picker';
import { PageSpinner } from '../../components/ui/spinner';
import { errorMessage } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useProjects } from '../projects/hooks';
import { useMemberMap, useWorkspace, useWorkspaceId } from '../workspaces/hooks';
import { useCreateDoc, useDocs } from './hooks';
import { toast } from 'sonner';

const ALL = '__all__';
const WORKSPACE = '__workspace__';

export function DocsPage() {
  const workspaceId = useWorkspaceId();
  const workspace = useWorkspace();
  const projects = useProjects();
  const members = useMemberMap();
  const docs = useDocs();
  const create = useCreateDoc();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string>(ALL);

  const projectName = useMemo(
    () => new Map((projects.data ?? []).map((p) => [p.id, p])),
    [projects.data],
  );
  const visible = (docs.data ?? []).filter(
    (d) =>
      d.title.toLowerCase().includes(query.trim().toLowerCase()) &&
      (scope === ALL || (scope === WORKSPACE ? d.projectId === null : d.projectId === scope)),
  );

  const canCreateWorkspaceDoc =
    workspace.data && canInWorkspace(workspace.data.role, { action: 'project:create' });
  const newDoc = (projectId: string | null) =>
    create.mutate(
      { title: 'Untitled', projectId },
      {
        onSuccess: (d) => navigate(`/w/${workspaceId}/docs/${d.id}`),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  if (!docs.data) return <PageSpinner />;

  const createOptions = [
    ...(canCreateWorkspaceDoc ? [{ value: WORKSPACE, label: 'Workspace doc' }] : []),
    ...(projects.data ?? [])
      .filter((p) => p.role !== 'viewer')
      .map((p) => ({ value: p.id, label: `In ${p.name}` })),
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Docs</h1>
            <p className="mt-1 text-[13px] text-fg-muted">
              Specs, notes and everything worth writing down.
            </p>
          </div>
          {createOptions.length > 0 && (
            <Picker
              value={null}
              align="end"
              onChange={(v) => newDoc(v === WORKSPACE ? null : v)}
              options={createOptions}
              trigger={
                <Button variant="primary" loading={create.isPending}>
                  <Plus className="size-3.5" /> New doc
                </Button>
              }
            />
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search docs by title"
              className="h-8 w-full rounded-md border border-border bg-surface pr-2 pl-8 text-[13px] outline-none placeholder:text-fg-subtle focus:border-accent"
            />
          </div>
          <Picker
            value={scope}
            onChange={setScope}
            options={[
              { value: ALL, label: 'All docs' },
              { value: WORKSPACE, label: 'Workspace docs' },
              ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
            ]}
            trigger={
              <Button>
                {scope === ALL
                  ? 'All docs'
                  : scope === WORKSPACE
                    ? 'Workspace docs'
                    : projectName.get(scope)?.name}
              </Button>
            }
          />
        </div>

        {visible.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-border">
            <EmptyState
              icon={<FileText className="size-5" />}
              title={docs.data.length ? 'No docs match' : 'No docs yet'}
              description={
                docs.data.length
                  ? 'Try another search or filter.'
                  : 'Write your first spec, plan or meeting note.'
              }
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            {visible.map((d) => {
              const editor = d.updatedBy ? members.get(d.updatedBy) : undefined;
              const project = d.projectId ? projectName.get(d.projectId) : null;
              return (
                <li key={d.id}>
                  <Link
                    to={`/w/${workspaceId}/docs/${d.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-hover/60"
                  >
                    <FileText className="size-4 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{d.title}</span>
                      <span className="block truncate text-[12px] text-fg-subtle">
                        {project ? project.name : 'Workspace'} · edited {timeAgo(d.updatedAt)}
                        {editor && ` by ${editor.name}`}
                      </span>
                    </span>
                    {editor && (
                      <Avatar
                        user={{ id: editor.userId, name: editor.name, avatarUrl: editor.avatarUrl }}
                        size={22}
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

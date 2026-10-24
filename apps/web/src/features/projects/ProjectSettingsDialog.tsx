import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  projectRoles,
  statusCategories,
  type ProjectDetail,
  type ProjectRole,
  type StatusCategory,
} from '@team-os/shared';
import { StatusIcon } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Textarea } from '../../components/ui/input';
import { Avatar } from '../../components/ui/misc';
import { Picker } from '../../components/ui/picker';
import { errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useMembers, useWorkspace, useWorkspaceId } from '../workspaces/hooks';
import {
  useDeleteProject,
  useProjectPeople,
  useSetProjectMember,
  useStatusMutations,
  useUpdateProject,
} from './hooks';

const categoryLabels: Record<StatusCategory, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  canceled: 'Canceled',
};

const palette = [
  '#9ca3af',
  '#6b7280',
  '#f59e0b',
  '#8b5cf6',
  '#3b82f6',
  '#10b981',
  '#ef4444',
  '#ec4899',
];

function General({ project, onDone }: { project: ProjectDetail; onDone: () => void }) {
  const update = useUpdateProject(project.id);
  const remove = useDeleteProject(project.id);
  const navigate = useNavigate();
  const workspaceId = useWorkspaceId();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);

  return (
    <div className="space-y-5">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate(
            { name, description },
            { onSuccess: () => toast.success('Project updated') },
          );
        }}
      >
        <Field label="Name">
          <Input value={name} required onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-16"
          />
        </Field>
        <Button type="submit" variant="primary" size="sm" loading={update.isPending}>
          Save
        </Button>
      </form>

      <div className="space-y-3 border-t border-border pt-4">
        <Toggle
          label="Private project"
          text="Only people you add (and workspace admins) can see it."
          checked={project.visibility === 'private'}
          onChange={(on) => update.mutate({ visibility: on ? 'private' : 'workspace' })}
        />
        <Toggle
          label="Enforce dependencies"
          text="Tasks can't be marked done while something still blocks them."
          checked={project.enforceDependencies}
          onChange={(on) => update.mutate({ enforceDependencies: on })}
        />
      </div>

      <div className="rounded-lg border border-danger/30 p-3">
        <div className="text-[13px] font-medium">Delete project</div>
        <p className="mt-0.5 text-[12px] text-fg-muted">
          Deletes the project and all of its tasks for everyone.
        </p>
        <Button
          variant="danger"
          size="sm"
          className="mt-3"
          loading={remove.isPending}
          onClick={() => {
            if (prompt(`Type ${project.key} to delete this project`) === project.key) {
              remove.mutate(undefined, {
                onSuccess: () => {
                  onDone();
                  navigate(`/w/${workspaceId}`);
                },
              });
            }
          }}
        >
          <Trash2 className="size-3.5" /> Delete project
        </Button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  text,
  checked,
  onChange,
}: {
  label: string;
  text: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-[12px] text-fg-muted">{text}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-border-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  );
}

function Statuses({ project }: { project: ProjectDetail }) {
  const { create, update, remove } = useStatusMutations(project.id);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StatusCategory>('todo');
  const onError = (err: unknown) => toast.error(errorMessage(err));

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {project.statuses.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-2 py-1.5">
            <Picker
              value={s.color}
              onChange={(color) => update.mutate({ id: s.id, color }, { onError })}
              options={palette.map((c) => ({
                value: c,
                label: c,
                icon: <span className="size-3 rounded-full" style={{ background: c }} />,
              }))}
              trigger={
                <button className="rounded p-1 hover:bg-hover" aria-label="Change color">
                  <StatusIcon category={s.category} color={s.color} />
                </button>
              }
            />
            <input
              defaultValue={s.name}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== s.name &&
                update.mutate({ id: s.id, name: e.target.value.trim() }, { onError })
              }
              className="h-7 flex-1 rounded-md bg-transparent px-1.5 text-[13px] outline-none hover:bg-hover focus:bg-surface"
            />
            <Picker
              value={s.category}
              onChange={(c) => update.mutate({ id: s.id, category: c }, { onError })}
              options={statusCategories.map((c) => ({ value: c, label: categoryLabels[c] }))}
              trigger={
                <Button size="sm" variant="ghost">
                  {categoryLabels[s.category]}
                </Button>
              }
            />
            <Picker
              value={null}
              align="end"
              placeholder="Move its tasks to…"
              onChange={(moveTo) => remove.mutate({ id: s.id, moveTo }, { onError })}
              options={project.statuses
                .filter((x) => x.id !== s.id)
                .map((x) => ({ value: x.id, label: `Delete and move tasks to ${x.name}` }))}
              trigger={
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${s.name}`}
                  disabled={project.statuses.length === 1}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              }
            />
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name, category, color: '#6b7280' },
            { onSuccess: () => setName(''), onError },
          );
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New status name"
          required
        />
        <Picker
          value={category}
          onChange={setCategory}
          options={statusCategories.map((c) => ({ value: c, label: categoryLabels[c] }))}
          trigger={<Button>{categoryLabels[category]}</Button>}
        />
        <Button type="submit" variant="primary" loading={create.isPending}>
          <Plus className="size-3.5" /> Add
        </Button>
      </form>
    </div>
  );
}

function Access({ project }: { project: ProjectDetail }) {
  const people = useProjectPeople(project.id);
  const workspace = useWorkspace();
  const members = useMembers(workspace.data?.role !== 'guest');
  const setMember = useSetProjectMember(project.id);
  const inProject = new Set(people.data?.map((p) => p.userId));
  const addable = (members.data ?? []).filter((m) => !inProject.has(m.userId));
  const onError = (err: unknown) => toast.error(errorMessage(err));

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-fg-muted">
        Workspace owners and admins always administer every project.
        {project.visibility === 'workspace' &&
          ' Workspace members are editors unless you set a role here.'}
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {people.data?.map((p) => (
          <li key={p.userId} className="flex items-center gap-2.5 px-3 py-2">
            <Avatar user={{ id: p.userId, name: p.name, avatarUrl: p.avatarUrl }} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{p.name}</span>
              <span className="block truncate text-[12px] text-fg-subtle">{p.email}</span>
            </span>
            <Picker
              value={p.role}
              align="end"
              onChange={(role: ProjectRole) =>
                setMember.mutate({ userId: p.userId, role }, { onError })
              }
              options={projectRoles.map((r) => ({
                value: r,
                label: r[0]!.toUpperCase() + r.slice(1),
              }))}
              trigger={
                <Button size="sm" variant="ghost" className="capitalize">
                  {p.role}
                </Button>
              }
            />
          </li>
        ))}
      </ul>
      {addable.length > 0 && (
        <Picker
          value={null}
          placeholder="Add someone…"
          onChange={(userId) => setMember.mutate({ userId, role: 'editor' }, { onError })}
          options={addable.map((m) => ({
            value: m.userId,
            label: m.name,
            keywords: m.email,
            icon: (
              <Avatar user={{ id: m.userId, name: m.name, avatarUrl: m.avatarUrl }} size={16} />
            ),
          }))}
          trigger={
            <Button size="sm">
              <Plus className="size-3.5" /> Add people
            </Button>
          }
        />
      )}
    </div>
  );
}

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project: ProjectDetail;
}) {
  const [tab, setTab] = useState<'general' | 'statuses' | 'access'>('general');
  const tabs = [
    ['general', 'General'],
    ['statuses', 'Statuses'],
    ['access', 'Access'],
  ] as const;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${project.name} settings`}
      className="max-w-lg"
    >
      <div className="mb-4 flex gap-1 border-b border-border">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={cn(
              '-mb-px border-b-2 px-2.5 pb-2 text-[13px] font-medium',
              tab === value
                ? 'border-accent text-fg'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {tab === 'general' && <General project={project} onDone={() => onOpenChange(false)} />}
        {tab === 'statuses' && <Statuses project={project} />}
        {tab === 'access' && <Access project={project} />}
      </div>
    </Dialog>
  );
}

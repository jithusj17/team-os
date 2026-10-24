import { useState } from 'react';
import { toast } from 'sonner';
import {
  canInWorkspace,
  notificationTypes,
  type NotificationType,
  type Workspace,
} from '@team-os/shared';
import { Button } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';
import { PageSpinner } from '../../components/ui/spinner';
import { errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { usePreferences, useUpdatePreferences } from '../notifications/hooks';
import { useDeleteWorkspace, useUpdateWorkspace, useWorkspace } from './hooks';

const typeLabels: Record<NotificationType, string> = {
  assigned: 'Assigned to me',
  mentioned: 'Mentioned',
  commented: 'Comments on tasks I watch',
  status_changed: 'Status changes on tasks I watch',
  blocker_resolved: 'A blocker of my task is done',
  due_soon: 'Due date reminders',
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 border-b border-border py-8 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-fg-muted">{description}</p>}
      </div>
      <div>{children}</div>
    </section>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
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
  );
}

function NotificationSettings() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  if (!prefs.data) return <PageSpinner />;
  const { mutedTypes, emailDigest } = prefs.data;
  const save = (next: { mutedTypes?: NotificationType[]; emailDigest?: boolean }) =>
    update.mutate(
      { mutedTypes, emailDigest, ...next },
      { onError: (err) => toast.error(errorMessage(err)) },
    );

  return (
    <div className="space-y-1">
      {notificationTypes.map((type) => (
        <label key={type} className="flex h-9 items-center justify-between gap-4 text-[13px]">
          {typeLabels[type]}
          <Switch
            label={typeLabels[type]}
            checked={!mutedTypes.includes(type)}
            onChange={(on) =>
              save({
                mutedTypes: on ? mutedTypes.filter((t) => t !== type) : [...mutedTypes, type],
              })
            }
          />
        </label>
      ))}
      <div className="mt-3 flex items-center justify-between gap-4 border-t border-border pt-4 text-[13px]">
        <span>
          <span className="block font-medium">Daily email digest</span>
          <span className="block text-[12px] text-fg-muted">
            A summary of unread notifications each morning.
          </span>
        </span>
        <Switch
          label="Daily email digest"
          checked={emailDigest}
          onChange={(on) => save({ emailDigest: on })}
        />
      </div>
    </div>
  );
}

function WorkspaceForm({ ws, canEdit }: { ws: Workspace; canEdit: boolean }) {
  const update = useUpdateWorkspace();
  const [name, setName] = useState(ws.name);
  const [slug, setSlug] = useState(ws.slug);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({ name, slug }, { onSuccess: () => toast.success('Workspace updated') });
      }}
    >
      <Field label="Name">
        <Input
          value={name}
          disabled={!canEdit}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field
        label="URL"
        hint="Lowercase letters, numbers and hyphens."
        error={update.error ? errorMessage(update.error) : null}
      >
        <div className="flex items-center rounded-md border border-border bg-muted pl-2.5 text-[13px] text-fg-subtle focus-within:border-accent">
          team-os.app/
          <input
            value={slug}
            disabled={!canEdit}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            className="h-8 flex-1 rounded-r-md bg-surface px-1.5 text-fg outline-none"
          />
        </div>
      </Field>
      {canEdit && (
        <Button type="submit" variant="primary" size="sm" loading={update.isPending}>
          Save changes
        </Button>
      )}
    </form>
  );
}

export function SettingsPage() {
  const workspace = useWorkspace();
  const remove = useDeleteWorkspace();

  if (!workspace.data) return <PageSpinner />;
  const ws = workspace.data;
  const canEdit = canInWorkspace(ws.role, { action: 'workspace:update' });
  const canDelete = canInWorkspace(ws.role, { action: 'workspace:delete' });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

        <Section
          title="Workspace"
          description={
            canEdit ? 'Name and URL for this workspace.' : 'Only admins can change these.'
          }
        >
          <WorkspaceForm key={ws.id} ws={ws} canEdit={canEdit} />
        </Section>

        <Section
          title="Notifications"
          description="Choose what you hear about. These settings are yours alone."
        >
          <NotificationSettings />
        </Section>

        {canDelete && (
          <Section title="Danger zone">
            <div className="rounded-lg border border-danger/30 p-4">
              <div className="text-[13px] font-medium">Delete workspace</div>
              <p className="mt-0.5 text-[12px] text-fg-muted">
                Permanently deletes {ws.name}, its projects, tasks and members. This can’t be
                undone.
              </p>
              <Button
                variant="danger"
                size="sm"
                className="mt-3"
                loading={remove.isPending}
                onClick={() => {
                  if (prompt(`Type "${ws.name}" to delete this workspace`) === ws.name) {
                    remove.mutate(undefined, {
                      onSuccess: () => window.location.assign('/'),
                      onError: (err) => toast.error(errorMessage(err)),
                    });
                  }
                }}
              >
                Delete workspace
              </Button>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

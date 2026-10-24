import { useState } from 'react';
import type { Meeting } from '@team-os/shared';
import { Button } from '../../components/ui/button';
import { Dialog, DialogFooter } from '../../components/ui/dialog';
import { Field, Input, Textarea } from '../../components/ui/input';
import { Avatar } from '../../components/ui/misc';
import { Picker } from '../../components/ui/picker';
import { errorMessage } from '../../lib/api';
import { useCurrentUser } from '../auth/hooks';
import { useProjectPeople, useProjects } from '../projects/hooks';
import { useMembers, useWorkspace } from '../workspaces/hooks';
import { useMeetingMutations } from './hooks';

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const combine = (date: string, time: string) => new Date(`${date}T${time}`);

const NO_PROJECT = '__none__';

/** Create a meeting (from `start`), or edit `existing`. */
export function MeetingDialog({
  open,
  onOpenChange,
  start,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  start?: Date;
  existing?: Meeting;
  onSaved?: (m: Meeting) => void;
}) {
  const me = useCurrentUser();
  const workspace = useWorkspace();
  const projects = useProjects();
  const { create, update } = useMeetingMutations();
  const initialStart = existing?.startsAt ?? start ?? new Date();
  const initialEnd = existing?.endsAt ?? new Date(initialStart.getTime() + 30 * 60_000);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(toDateInput(initialStart));
  const [from, setFrom] = useState(toTimeInput(initialStart));
  const [to, setTo] = useState(toTimeInput(initialEnd));
  const [projectId, setProjectId] = useState<string>(existing?.projectId ?? NO_PROJECT);
  const [attendees, setAttendees] = useState<string[]>(
    existing?.attendees.map((a) => a.userId).filter((id) => id !== existing.organizerId) ?? [],
  );
  const [location, setLocation] = useState(existing?.location ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');

  const projectPeople = useProjectPeople(projectId === NO_PROJECT ? '' : projectId);
  const members = useMembers(workspace.data?.role !== 'guest');
  const people = (
    projectId === NO_PROJECT
      ? (members.data ?? []).map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
          avatarUrl: m.avatarUrl,
        }))
      : (projectPeople.data ?? [])
  ).filter((p) => p.userId !== me.id);

  const mutation = existing ? update : create;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      title,
      description,
      location,
      startsAt: combine(date, from).toISOString(),
      endsAt: combine(date, to).toISOString(),
      attendeeIds: attendees,
    };
    const saved = existing
      ? await update.mutateAsync({ ...body, id: existing.id, version: existing.version })
      : await create.mutateAsync({
          ...body,
          projectId: projectId === NO_PROJECT ? null : projectId,
        });
    onOpenChange(false);
    onSaved?.(saved);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? 'Edit meeting' : 'New meeting'}
      className="max-w-lg"
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Title">
          <Input
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sprint planning"
          />
        </Field>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <Field label="Date">
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="From">
            <Input type="time" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="time" required value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {!existing && (
          <Field
            label="Project"
            hint="Project meetings and their notes are visible to everyone in the project."
          >
            <Picker
              value={projectId}
              onChange={(v) => {
                setProjectId(v);
                setAttendees([]);
              }}
              options={[
                { value: NO_PROJECT, label: 'No project (workspace)' },
                ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
              ]}
              trigger={
                <Button className="w-full justify-start">
                  {projectId === NO_PROJECT
                    ? 'No project (workspace)'
                    : projects.data?.find((p) => p.id === projectId)?.name}
                </Button>
              }
            />
          </Field>
        )}
        <div className="space-y-1.5">
          <span className="text-[13px] font-medium">Attendees</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {attendees.map((id) => {
              const p = people.find((x) => x.userId === id);
              return (
                <span
                  key={id}
                  className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border pr-2 pl-0.5 text-[12px]"
                >
                  <Avatar user={{ id, name: p?.name ?? '?', avatarUrl: p?.avatarUrl }} size={20} />
                  {p?.name ?? 'Someone'}
                </span>
              );
            })}
            <Picker
              multiple
              value={attendees}
              onChange={(id) =>
                setAttendees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))
              }
              options={people.map((p) => ({
                value: p.userId,
                label: p.name,
                keywords: p.email,
                icon: (
                  <Avatar user={{ id: p.userId, name: p.name, avatarUrl: p.avatarUrl }} size={16} />
                ),
              }))}
              trigger={<Button size="sm">Add people</Button>}
            />
          </div>
        </div>
        <Field label="Location or link">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Room 4 or https://meet…"
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-16"
            placeholder="Agenda, context…"
          />
        </Field>
        {mutation.error && (
          <p className="text-[13px] text-danger">{errorMessage(mutation.error)}</p>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            {existing ? 'Save' : 'Create meeting'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

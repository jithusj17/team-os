import { useState } from 'react';
import type { ProjectDetail, ProjectMember, TaskPriority } from '@team-os/shared';
import { Button } from '../../components/ui/button';
import { Dialog, DialogFooter } from '../../components/ui/dialog';
import { Kbd } from '../../components/ui/misc';
import { Textarea } from '../../components/ui/input';
import { useLabels } from '../workspaces/hooks';
import { AssigneePicker, LabelPicker, PriorityPicker, StatusPicker } from './fields';
import { useCreateTask } from './hooks';

export function CreateTaskDialog({
  open,
  onOpenChange,
  project,
  people,
  defaultStatusId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectDetail;
  people: ProjectMember[];
  defaultStatusId?: string;
  onCreated: (taskId: string) => void;
}) {
  const create = useCreateTask(project.id);
  const labels = useLabels();
  const firstTodo = project.statuses.find((s) => s.category === 'todo') ?? project.statuses[0];
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [statusId, setStatusId] = useState(defaultStatusId ?? firstTodo?.id ?? '');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);

  // Each time the dialog opens, start in the requested (or default) status.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setStatusId(defaultStatusId ?? firstTodo?.id ?? '');
  }

  const reset = () => {
    setTitle('');
    setDescription('');
    setPriority('none');
    setAssigneeId(null);
    setLabelIds([]);
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return;
    const task = await create.mutateAsync({
      title: title.trim(),
      description,
      statusId,
      priority,
      assigneeId,
      labelIds,
    });
    reset();
    onOpenChange(false);
    onCreated(task.id);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`New task in ${project.name}`}
      className="max-w-xl"
    >
      <form
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
        }}
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          className="w-full bg-transparent text-[17px] font-semibold outline-none placeholder:text-fg-subtle"
        />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a description…"
          className="mt-3 min-h-24 border-none px-0 shadow-none focus:ring-0"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border pt-3">
          <StatusPicker statuses={project.statuses} value={statusId} onChange={setStatusId} />
          <PriorityPicker value={priority} onChange={setPriority} />
          <AssigneePicker people={people} value={assigneeId} onChange={setAssigneeId} />
          <LabelPicker labels={labels.data ?? []} value={labelIds} onChange={setLabelIds} />
        </div>
        <DialogFooter>
          <span className="mr-auto hidden items-center gap-1 text-[12px] text-fg-subtle sm:flex">
            <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> to create
          </span>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!title.trim()}
            loading={create.isPending}
          >
            Create task
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

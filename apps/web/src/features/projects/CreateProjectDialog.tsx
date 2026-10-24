import { Globe, Lock } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { ProjectVisibility } from '@team-os/shared';
import { Button } from '../../components/ui/button';
import { Dialog, DialogFooter } from '../../components/ui/dialog';
import { Field, Input, Textarea } from '../../components/ui/input';
import { errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useWorkspaceId } from '../workspaces/hooks';
import { useCreateProject } from './hooks';

/** "Mobile App" -> "MA", "Engineering" -> "ENG". */
function suggestKey(name: string) {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  return /^[A-Z]/.test(key) ? key.slice(0, 10) : '';
}

export function CreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const workspaceId = useWorkspaceId();
  const navigate = useNavigate();
  const create = useCreateProject();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ProjectVisibility>('workspace');

  const reset = () => {
    setName('');
    setKey('');
    setKeyEdited(false);
    setDescription('');
    setVisibility('workspace');
    create.reset();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const project = await create.mutateAsync({ name, key, description, visibility });
    onOpenChange(false);
    reset();
    navigate(`/w/${workspaceId}/p/${project.id}`);
  }

  const options = [
    { value: 'workspace', icon: Globe, title: 'Workspace', text: 'Everyone in the workspace' },
    { value: 'private', icon: Lock, title: 'Private', text: 'Only people you add' },
  ] as const;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
      title="New project"
      description="Projects group tasks into a board with their own statuses."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field label="Name">
            <Input
              autoFocus
              required
              value={name}
              placeholder="Engineering"
              onChange={(e) => {
                setName(e.target.value);
                if (!keyEdited) setKey(suggestKey(e.target.value));
              }}
            />
          </Field>
          <Field label="Key">
            <Input
              required
              value={key}
              maxLength={10}
              placeholder="ENG"
              className="font-mono uppercase"
              onChange={(e) => {
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                setKeyEdited(true);
              }}
            />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-fg-subtle">
          Tasks will be numbered {key || 'KEY'}-1, {key || 'KEY'}-2, …
        </p>
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project about? (optional)"
            className="min-h-16"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {options.map(({ value, icon: Icon, title, text }) => (
            <button
              key={value}
              type="button"
              onClick={() => setVisibility(value)}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                visibility === value
                  ? 'border-accent bg-accent-soft'
                  : 'border-border hover:bg-hover',
              )}
            >
              <Icon
                className={cn('size-4', visibility === value ? 'text-accent' : 'text-fg-muted')}
              />
              <div className="mt-2 text-[13px] font-medium">{title}</div>
              <div className="text-xs text-fg-muted">{text}</div>
            </button>
          ))}
        </div>
        {create.error && <p className="text-[13px] text-danger">{errorMessage(create.error)}</p>}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create project
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

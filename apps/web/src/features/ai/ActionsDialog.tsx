import { AlertCircle, Check, CheckSquare, MessageSquare, PencilLine, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { AiAction, AiProposal } from '@team-os/shared';
import { PriorityIcon, priorityLabels } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { Dialog, DialogFooter } from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/input';
import { errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useMemberMap } from '../workspaces/hooks';
import { useExecuteProposal, useProposeActions, type ProposalSource } from './hooks';

const typeMeta = {
  create_task: { icon: CheckSquare, label: 'Create task' },
  update_task: { icon: PencilLine, label: 'Update' },
  add_comment: { icon: MessageSquare, label: 'Comment on' },
} as const;

function ActionRow({
  action,
  checked,
  onToggle,
  result,
  workspaceId,
  memberName,
}: {
  action: AiAction;
  checked: boolean;
  onToggle: () => void;
  result?: NonNullable<AiProposal['results']>[number];
  workspaceId: string;
  memberName: (id: string) => string;
}) {
  const meta = typeMeta[action.type];
  const disabled = action.error !== null || result !== undefined;
  const details = [
    action.assigneeId && `→ ${memberName(action.assigneeId)}`,
    action.dueDate && `due ${action.dueDate}`,
  ].filter(Boolean);
  return (
    <label
      className={cn(
        'flex gap-3 rounded-lg border border-border px-3 py-2.5',
        action.error ? 'bg-muted/60' : 'cursor-pointer hover:bg-hover',
        result && 'cursor-default',
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 accent-[var(--accent)]"
        checked={checked && !action.error}
        disabled={disabled}
        onChange={onToggle}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <meta.icon className="size-3.5 text-fg-muted" />
          <span className="text-fg-muted">{meta.label}</span>
          {action.type === 'create_task' ? (
            <span className="font-medium">{action.title ?? 'Untitled'}</span>
          ) : (
            <span className="font-medium">{action.taskKey}</span>
          )}
          {action.type === 'create_task' && action.projectKey && (
            <span className="text-fg-subtle">in {action.projectKey}</span>
          )}
          {action.priority && action.priority !== 'none' && (
            <span className="inline-flex items-center gap-1 text-[12px] text-fg-muted">
              <PriorityIcon priority={action.priority} className="size-3.5" />
              {priorityLabels[action.priority]}
            </span>
          )}
        </div>
        {action.type === 'update_task' && action.title && (
          <p className="text-[12px] text-fg-muted">Rename to “{action.title}”</p>
        )}
        {action.comment && (
          <p className="line-clamp-3 text-[12px] whitespace-pre-wrap text-fg-muted">
            “{action.comment}”
          </p>
        )}
        {details.length > 0 && <p className="text-[12px] text-fg-muted">{details.join(' · ')}</p>}
        {action.reason && <p className="text-[11px] text-fg-subtle">{action.reason}</p>}
        {action.error && (
          <p className="flex items-center gap-1 text-[12px] text-danger">
            <AlertCircle className="size-3.5" /> {action.error}
          </p>
        )}
        {result &&
          (result.ok ? (
            <p className="flex items-center gap-1 text-[12px] text-success">
              <Check className="size-3.5" /> Done
              {result.taskKey && (
                <Link
                  to={`/w/${workspaceId}/tasks/${result.taskKey}`}
                  className="ml-1 font-medium underline underline-offset-2"
                >
                  {result.taskKey}
                </Link>
              )}
            </p>
          ) : (
            <p className="flex items-center gap-1 text-[12px] text-danger">
              <AlertCircle className="size-3.5" /> {result.error}
            </p>
          ))}
      </div>
    </label>
  );
}

/**
 * Describe what to do in plain words; the AI proposes concrete actions, and nothing
 * happens until you confirm them. The server re-checks every action with your permissions.
 */
export function ActionsDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId = null,
  source = null,
  defaultInstruction = '',
  title = 'AI actions',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId?: string | null;
  source?: ProposalSource | null;
  defaultInstruction?: string;
  title?: string;
}) {
  const [instruction, setInstruction] = useState(defaultInstruction);
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const propose = useProposeActions();
  const execute = useExecuteProposal();
  const members = useMemberMap();
  const memberName = (id: string) => members.get(id)?.name ?? 'Someone';

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setProposal(null);
      setInstruction(defaultInstruction);
      propose.reset();
      execute.reset();
    }
  };

  const submit = () =>
    propose.mutate(
      { instruction: instruction.trim(), projectId, source },
      {
        onSuccess: (p) => {
          setProposal(p);
          setSelected(new Set(p.actions.filter((a) => !a.error).map((a) => a.id)));
        },
      },
    );

  const confirm = () =>
    proposal &&
    execute.mutate({ id: proposal.id, actionIds: [...selected] }, { onSuccess: setProposal });

  const executed = proposal?.status === 'executed';
  const resultFor = (id: number) => proposal?.results?.find((r) => r.actionId === id);

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={title}
      description={
        proposal ? undefined : 'Describe what you want done. You review every change first.'
      }
      className="max-w-xl"
    >
      {!proposal ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (instruction.trim().length >= 3) submit();
          }}
        >
          <Textarea
            autoFocus
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
                e.currentTarget.form?.requestSubmit();
            }}
            maxLength={2000}
            placeholder="e.g. Create tasks for the launch checklist and assign the copy work to Dana, due next Friday"
            className="min-h-28"
          />
          {propose.isError && (
            <p className="mt-2 text-[13px] text-danger">{errorMessage(propose.error)}</p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={propose.isPending}
              disabled={instruction.trim().length < 3}
            >
              <Sparkles className="size-3.5" /> Propose actions
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <div>
          <p className="mb-3 text-[13px] text-fg-muted">{proposal.summary}</p>
          {proposal.actions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-fg-subtle">
              The AI didn't find anything to do. Try being more specific.
            </p>
          ) : (
            <div className="max-h-[50vh] space-y-2 overflow-y-auto">
              {proposal.actions.map((a) => (
                <ActionRow
                  key={a.id}
                  action={a}
                  workspaceId={workspaceId}
                  memberName={memberName}
                  checked={executed ? resultFor(a.id) !== undefined : selected.has(a.id)}
                  result={resultFor(a.id)}
                  onToggle={() =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (next.has(a.id)) next.delete(a.id);
                      else next.add(a.id);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
          {execute.isError && (
            <p className="mt-2 text-[13px] text-danger">{errorMessage(execute.error)}</p>
          )}
          <DialogFooter>
            {executed ? (
              <Button variant="primary" onClick={() => close(false)}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setProposal(null)}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  onClick={confirm}
                  loading={execute.isPending}
                  disabled={selected.size === 0}
                >
                  Apply {selected.size} {selected.size === 1 ? 'change' : 'changes'}
                </Button>
              </>
            )}
          </DialogFooter>
        </div>
      )}
    </Dialog>
  );
}

import { MoreHorizontal } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  MENTION_PATTERN,
  type ActivityEntry,
  type Comment,
  type ProjectDetail,
  type ProjectMember,
} from '@team-os/shared';
import { priorityLabels } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu';
import { Avatar } from '../../components/ui/misc';
import { cn } from '../../lib/cn';
import { formatDate, parseDay, timeAgo } from '../../lib/format';
import { useActivity, useCommentMutations, useComments } from './hooks';

type People = Map<string, ProjectMember>;

/** Renders a comment body, turning <@userId> tokens into @Name chips. */
function CommentBody({ body, people }: { body: string; people: People }) {
  const parts = body.split(new RegExp(MENTION_PATTERN.source, 'gi'));
  return (
    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rounded bg-accent-soft px-1 font-medium text-accent">
            @{people.get(part.toLowerCase())?.name ?? 'someone'}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/** One readable line per change, e.g. "changed status from Todo to Done". */
function describeChanges(entry: ActivityEntry, project: ProjectDetail, people: People): string[] {
  const statusName = (id: unknown) =>
    project.statuses.find((s) => s.id === id)?.name ?? 'a deleted status';
  const personName = (id: unknown) =>
    id ? (people.get(id as string)?.name ?? 'someone') : 'no one';
  const lines: string[] = [];
  for (const [field, { from, to }] of Object.entries(entry.changes ?? {})) {
    switch (field) {
      case 'statusId':
        lines.push(`moved from ${statusName(from)} to ${statusName(to)}`);
        break;
      case 'assigneeId':
        lines.push(to ? `assigned to ${personName(to)}` : 'removed the assignee');
        break;
      case 'priority':
        lines.push(`set priority to ${priorityLabels[to as keyof typeof priorityLabels] ?? to}`);
        break;
      case 'title':
        lines.push(`renamed to “${to as string}”`);
        break;
      case 'description':
        lines.push('updated the description');
        break;
      case 'dueDate':
        lines.push(
          to ? `set the due date to ${formatDate(parseDay(to as string))}` : 'removed the due date',
        );
        break;
      case 'estimate':
        lines.push(to === null ? 'removed the estimate' : `set the estimate to ${to as number}`);
        break;
      case 'parentId':
        lines.push(to ? 'moved under a parent task' : 'removed the parent task');
        break;
      case 'labels': {
        const added = (to as string[]).length;
        const removed = (from as string[]).length;
        lines.push(
          [
            added && `added ${added} label${added > 1 ? 's' : ''}`,
            removed && `removed ${removed} label${removed > 1 ? 's' : ''}`,
          ]
            .filter(Boolean)
            .join(' and '),
        );
        break;
      }
      case 'blockedBy':
        lines.push(to ? 'added a blocker' : 'removed a blocker');
        break;
    }
  }
  return lines;
}

type Item =
  | { kind: 'comment'; at: Date; comment: Comment }
  | { kind: 'activity'; at: Date; entry: ActivityEntry; lines: string[] };

function Composer({ taskId, people }: { taskId: string; people: ProjectMember[] }) {
  const { add } = useCommentMutations(taskId);
  const [text, setText] = useState('');
  const [mentioned, setMentioned] = useState<ProjectMember[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const suggestions =
    query === null
      ? []
      : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const onChange = (value: string) => {
    setText(value);
    const caret = ref.current?.selectionStart ?? value.length;
    const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    setQuery(match ? match[1]! : null);
  };

  const insertMention = (p: ProjectMember) => {
    const caret = ref.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, `@${p.name} `);
    setText(before + text.slice(caret));
    setMentioned((m) => (m.some((x) => x.userId === p.userId) ? m : [...m, p]));
    setQuery(null);
    ref.current?.focus();
  };

  const submit = () => {
    if (!text.trim()) return;
    // "@Name" stays readable while typing; the server receives <@userId> tokens.
    let body = text;
    for (const p of mentioned) body = body.split(`@${p.name}`).join(`<@${p.userId}>`);
    add.mutate(body, {
      onSuccess: () => {
        setText('');
        setMentioned([]);
      },
    });
  };

  return (
    <div className="relative rounded-lg border border-border bg-surface shadow-card focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
      <textarea
        ref={ref}
        value={text}
        rows={2}
        placeholder="Leave a comment… use @ to mention"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (suggestions.length && e.key === 'Enter') {
            e.preventDefault();
            insertMention(suggestions[0]!);
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') setQuery(null);
        }}
        className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] outline-none placeholder:text-fg-subtle"
      />
      <div className="flex items-center justify-end gap-2 px-2 pb-2">
        <span className="text-[11px] text-fg-subtle">Ctrl + Enter to send</span>
        <Button
          size="sm"
          variant="primary"
          disabled={!text.trim()}
          loading={add.isPending}
          onClick={submit}
        >
          Comment
        </Button>
      </div>
      {suggestions.length > 0 && (
        <div className="animate-pop absolute bottom-full left-2 z-20 mb-1 w-56 rounded-lg border border-border bg-raised p-1 shadow-pop">
          {suggestions.map((p) => (
            <button
              key={p.userId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(p);
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-hover"
            >
              <Avatar user={{ id: p.userId, name: p.name, avatarUrl: p.avatarUrl }} size={18} />
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  people,
  currentUserId,
  canModerate,
  taskId,
}: {
  comment: Comment;
  people: People;
  currentUserId: string;
  canModerate: boolean;
  taskId: string;
}) {
  const { edit, remove } = useCommentMutations(taskId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const author = comment.authorId ? people.get(comment.authorId) : undefined;
  const mine = comment.authorId === currentUserId;

  return (
    <div className="group rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2 text-[12px]">
        <Avatar
          user={
            author ? { id: author.userId, name: author.name, avatarUrl: author.avatarUrl } : null
          }
          size={18}
        />
        <span className="font-medium">{author?.name ?? 'Former member'}</span>
        <span className="text-fg-subtle">{timeAgo(comment.createdAt)}</span>
        {comment.editedAt && <span className="text-fg-subtle">(edited)</span>}
        <span className="flex-1" />
        {(mine || canModerate) && (
          <Menu>
            <MenuTrigger asChild>
              <button
                className="rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg"
                aria-label="Comment actions"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </MenuTrigger>
            <MenuContent align="end" className="min-w-36">
              {mine && <MenuItem onSelect={() => setEditing(true)}>Edit</MenuItem>}
              <MenuItem danger onSelect={() => remove.mutate(comment.id)}>
                Delete
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>
      <div className="mt-1.5 pl-[26px]">
        {editing ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full resize-none rounded-md border border-border bg-bg p-2 text-[13px] outline-none focus:border-accent"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={edit.isPending}
                onClick={() =>
                  edit.mutate(
                    { id: comment.id, body: draft },
                    { onSuccess: () => setEditing(false) },
                  )
                }
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <CommentBody body={comment.body} people={people} />
        )}
      </div>
    </div>
  );
}

export function TaskTimeline({
  taskId,
  project,
  people,
  currentUserId,
}: {
  taskId: string;
  project: ProjectDetail;
  people: ProjectMember[];
  currentUserId: string;
}) {
  const comments = useComments(taskId);
  const activity = useActivity(taskId);
  const peopleMap = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = (comments.data ?? []).map((c) => ({
      kind: 'comment',
      at: c.createdAt,
      comment: c,
    }));
    for (const entry of activity.data ?? []) {
      if (entry.type.startsWith('comment.')) continue; // comments are shown themselves
      const lines =
        entry.type === 'task.created'
          ? ['created the task']
          : describeChanges(entry, project, peopleMap);
      if (lines.length) list.push({ kind: 'activity', at: entry.createdAt, entry, lines });
    }
    return list.sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [comments.data, activity.data, project, peopleMap]);

  return (
    <section>
      <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">
        Activity
      </h3>
      <ol className="space-y-3">
        {items.map((item) =>
          item.kind === 'comment' ? (
            <li key={item.comment.id}>
              <CommentItem
                comment={item.comment}
                people={peopleMap}
                currentUserId={currentUserId}
                canModerate={project.role === 'admin'}
                taskId={taskId}
              />
            </li>
          ) : (
            <li
              key={item.entry.id}
              className="flex items-start gap-2 pl-1 text-[12px] text-fg-muted"
            >
              <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong')} />
              <span>
                <span className="font-medium text-fg">
                  {item.entry.actorId
                    ? (peopleMap.get(item.entry.actorId)?.name ?? 'Someone')
                    : 'Someone'}
                </span>{' '}
                {item.lines.join(', ')} · <span className="text-fg-subtle">{timeAgo(item.at)}</span>
              </span>
            </li>
          ),
        )}
      </ol>
      <div className="mt-4">
        <Composer taskId={taskId} people={people} />
      </div>
    </section>
  );
}

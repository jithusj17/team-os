import {
  ChevronRight,
  Eye,
  History,
  Link2,
  MoreHorizontal,
  PenLine,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import { Link, useNavigate, useParams } from 'react-router';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import type { Doc } from '@team-os/shared';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu';
import { Avatar, EmptyState } from '../../components/ui/misc';
import { Picker } from '../../components/ui/picker';
import { PageSpinner } from '../../components/ui/spinner';
import { ApiError, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { keys } from '../../lib/keys';
import { timeAgo } from '../../lib/format';
import { useProjects } from '../projects/hooks';
import { useMemberMap, useWorkspaceId } from '../workspaces/hooks';
import {
  fetchDocVersion,
  useAllVisibleTasks,
  useDoc,
  useDocMutations,
  useDocVersions,
} from './hooks';

type SaveState = 'saved' | 'saving' | 'unsaved' | 'conflict';

type Draft = { title: string; body: string };

/**
 * Autosave. With no local changes the editor shows the server copy (so teammates' edits
 * appear live); once you type it shows your draft until that draft is saved. Saves run one at
 * a time against the version the draft was based on, so a teammate's newer edit is a conflict
 * rather than a silent overwrite.
 */
function useAutosave(
  doc: Doc,
  save: ReturnType<typeof useDocMutations>['save'],
  settle: (d: Doc) => void,
) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const draftRef = useRef<Draft | null>(null);
  const base = useRef({ version: doc.version, title: doc.title, body: doc.body });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current) await inFlight.current;
    const current = draftRef.current;
    if (!current) return;

    const patch: { title?: string; body?: string } = {};
    if (current.title.trim() && current.title.trim() !== base.current.title)
      patch.title = current.title.trim();
    if (current.body !== base.current.body) patch.body = current.body;
    if (!Object.keys(patch).length) {
      draftRef.current = null;
      setDraft(null);
      return;
    }

    setSaving(true);
    inFlight.current = (async () => {
      try {
        const saved = await save({ version: base.current.version, ...patch });
        base.current = { version: saved.version, title: saved.title, body: saved.body };
        settle(saved);
        const latest = draftRef.current;
        if (latest && latest.title.trim() === saved.title && latest.body === saved.body) {
          draftRef.current = null;
          setDraft(null); // caught up: show the server copy again
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === 'version_conflict') setConflict(true);
        else toast.error(`Couldn't save: ${errorMessage(err)}`);
      } finally {
        inFlight.current = null;
        setSaving(false);
      }
    })();
    return inFlight.current;
  }, [save, settle]);

  const edit = (next: Partial<Draft>) => {
    if (!draftRef.current) {
      // Starting a new draft: it's based on the server copy we're looking at right now.
      base.current = { version: doc.version, title: doc.title, body: doc.body };
    }
    const updated = { title: doc.title, body: doc.body, ...draftRef.current, ...next };
    draftRef.current = updated;
    setDraft(updated);
    if (conflict) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  };

  // Save pending changes when leaving the page.
  useEffect(
    () => () => {
      if (timer.current) void flush();
    },
    [flush],
  );

  const queryClient = useQueryClient();
  const discardAndReload = () => {
    draftRef.current = null;
    setDraft(null);
    setConflict(false);
    void queryClient.invalidateQueries({ queryKey: keys.doc(doc.id) });
  };

  const state: SaveState = conflict ? 'conflict' : saving ? 'saving' : draft ? 'unsaved' : 'saved';
  return {
    title: draft?.title ?? doc.title,
    body: draft?.body ?? doc.body,
    state,
    edit,
    flush,
    discardAndReload,
  };
}

function HistoryDialog({
  doc,
  open,
  onOpenChange,
  onRestore,
}: {
  doc: Doc;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRestore: (v: { title: string; body: string }) => void;
}) {
  const versions = useDocVersions(doc.id, open);
  const members = useMemberMap();
  const [selected, setSelected] = useState<{ id: string; title: string; body: string } | null>(
    null,
  );

  const pick = async (id: string) => {
    try {
      const v = await fetchDocVersion(doc.id, id);
      setSelected({ id, title: v.title, body: v.body });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Version history" className="max-w-4xl">
      <div className="grid h-[60vh] gap-4 md:grid-cols-[220px_1fr]">
        <ul className="space-y-1 overflow-y-auto">
          {versions.data?.map((v, i) => {
            const author = v.authorId ? members.get(v.authorId) : undefined;
            return (
              <li key={v.id}>
                <button
                  onClick={() => pick(v.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover',
                    selected?.id === v.id && 'bg-hover',
                  )}
                >
                  <Avatar
                    user={author ? { id: author.userId, name: author.name } : null}
                    size={20}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">
                      {i === 0 ? 'Current version' : timeAgo(v.createdAt)}
                    </span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {author?.name ?? 'Someone'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex min-h-0 flex-col rounded-lg border border-border">
          {selected ? (
            <>
              <div className="doc-prose flex-1 overflow-y-auto p-5">
                <h1>{selected.title}</h1>
                <Markdown remarkPlugins={[remarkGfm]}>{selected.body}</Markdown>
              </div>
              {doc.canEdit && (
                <div className="flex justify-end border-t border-border p-3">
                  <Button
                    variant="primary"
                    onClick={() => {
                      onRestore(selected);
                      onOpenChange(false);
                    }}
                  >
                    Restore this version
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="m-auto text-[13px] text-fg-subtle">Pick a version to preview it.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Editor({ doc }: { doc: Doc }) {
  const workspaceId = useWorkspaceId();
  const navigate = useNavigate();
  const projects = useProjects();
  const { save, settle, link, remove } = useDocMutations(doc.id);
  const { title, body, state, edit, flush, discardAndReload } = useAutosave(doc, save, settle);
  const [mode, setMode] = useState<'write' | 'preview'>(
    doc.canEdit && !doc.body ? 'write' : 'preview',
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const allTasks = useAllVisibleTasks(linking);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const project = doc.projectId ? projects.data?.find((p) => p.id === doc.projectId) : null;

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [body, mode]);

  const linkable = useMemo(
    () => allTasks.filter((t) => !doc.linkedTasks.some((l) => l.id === t.id)),
    [allTasks, doc.linkedTasks],
  );

  const status = {
    saved: 'Saved',
    saving: 'Saving…',
    unsaved: 'Unsaved changes',
    conflict: 'Not saved',
  }[state];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-5">
        <Link to={`/w/${workspaceId}/docs`} className="text-[13px] text-fg-muted hover:text-fg">
          Docs
        </Link>
        <ChevronRight className="size-3.5 text-fg-subtle" />
        <span className="truncate text-[13px] text-fg-muted">{project?.name ?? 'Workspace'}</span>
        <span
          className={cn(
            'ml-2 text-[12px]',
            state === 'conflict' ? 'text-danger' : 'text-fg-subtle',
          )}
        >
          {status}
        </span>
        <span className="flex-1" />
        {doc.canEdit && (
          <div className="flex rounded-lg border border-border bg-muted p-0.5">
            {(
              [
                ['write', PenLine, 'Write'],
                ['preview', Eye, 'Preview'],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={cn(
                  'flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium',
                  mode === value ? 'bg-surface shadow-sm' : 'text-fg-muted hover:text-fg',
                )}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>
        )}
        <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
          <History className="size-3.5" /> History
        </Button>
        {doc.canDelete && (
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="More">
                <MoreHorizontal className="size-4" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem
                danger
                icon={<Trash2 className="size-3.5" />}
                onSelect={() =>
                  confirm(`Delete "${doc.title}"?`) &&
                  remove.mutate(undefined, { onSuccess: () => navigate(`/w/${workspaceId}/docs`) })
                }
              >
                Delete doc
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </header>

      {state === 'conflict' && (
        <div className="flex flex-wrap items-center gap-3 border-b border-danger/30 bg-danger-soft px-5 py-2 text-[13px] text-danger">
          Someone else changed this doc while you were editing. Your latest changes aren’t saved.
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(body);
              toast.success('Your text was copied to the clipboard');
            }}
          >
            Copy my text
          </Button>
          <Button size="sm" variant="primary" onClick={discardAndReload}>
            Load their version
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <article className="mx-auto max-w-3xl px-6 py-10">
          <input
            value={title}
            readOnly={!doc.canEdit}
            onChange={(e) => edit({ title: e.target.value })}
            onBlur={() => void flush()}
            placeholder="Untitled"
            className="w-full bg-transparent text-[30px] leading-tight font-bold tracking-tight outline-none placeholder:text-fg-subtle"
          />

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {doc.linkedTasks.map((t) => (
              <span
                key={t.id}
                className="group inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface pr-1 pl-2 text-[12px]"
              >
                <Link
                  to={`/w/${workspaceId}/p/${t.projectId}?task=${t.id}`}
                  className="flex items-center gap-1.5 hover:text-accent"
                >
                  <span className="font-mono text-fg-subtle">{t.key}</span>
                  <span className="max-w-48 truncate">{t.title}</span>
                </Link>
                {doc.canEdit && (
                  <button
                    aria-label={`Unlink ${t.key}`}
                    onClick={() => link.mutate({ taskId: t.id, link: false })}
                    className="rounded-full p-0.5 text-fg-subtle hover:bg-hover hover:text-fg"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
            {doc.canEdit && (
              <span onPointerDown={() => setLinking(true)}>
                <Picker
                  value={null}
                  placeholder="Find a task…"
                  onChange={(taskId) => link.mutate({ taskId, link: true })}
                  options={linkable.map((t) => ({ value: t.id, label: `${t.key} ${t.title}` }))}
                  trigger={
                    <Button size="sm" variant="ghost" className="h-6">
                      <Link2 className="size-3.5" /> Link task
                    </Button>
                  }
                />
              </span>
            )}
          </div>

          <div className="mt-8">
            {mode === 'write' && doc.canEdit ? (
              <textarea
                ref={textRef}
                value={body}
                autoFocus={!doc.body}
                onChange={(e) => edit({ body: e.target.value })}
                onBlur={() => void flush()}
                placeholder="Start writing… Markdown works: # headings, - lists, - [ ] checklists, **bold**, `code`, tables."
                className="min-h-[50vh] w-full resize-none overflow-hidden bg-transparent text-[15px] leading-7 outline-none placeholder:text-fg-subtle"
              />
            ) : body.trim() ? (
              <div className="doc-prose" onDoubleClick={() => doc.canEdit && setMode('write')}>
                <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
              </div>
            ) : (
              <p className="text-[15px] text-fg-subtle">This doc is empty.</p>
            )}
          </div>
        </article>
      </div>

      <HistoryDialog
        doc={doc}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestore={(v) => {
          edit(v);
          void flush().then(() => toast.success('Version restored'));
        }}
      />
    </div>
  );
}

export function DocPage() {
  const { docId = '' } = useParams();
  const doc = useDoc(docId);
  if (doc.isError) {
    return (
      <EmptyState
        icon={<X className="size-5" />}
        title="Doc not found"
        description="It may have been deleted, or you don't have access."
      />
    );
  }
  if (!doc.data) return <PageSpinner />;
  return <Editor key={doc.data.id} doc={doc.data} />;
}

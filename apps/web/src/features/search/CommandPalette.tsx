import * as RadixDialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  CheckSquare,
  FileText,
  FolderKanban,
  MessageSquare,
  Search,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { HIGHLIGHT_END, HIGHLIGHT_START, searchResponse, type SearchResult } from '@team-os/shared';
import { Kbd } from '../../components/ui/misc';
import { Spinner } from '../../components/ui/spinner';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { AiText, sourceLink } from '../ai/components';
import { useAiEnabled, useAiStream } from '../ai/hooks';
import { useProjects } from '../projects/hooks';
import { useWorkspaceId } from '../workspaces/hooks';

const typeIcon = {
  task: <CheckSquare className="size-4" />,
  comment: <MessageSquare className="size-4" />,
  doc: <FileText className="size-4" />,
  meeting: <CalendarDays className="size-4" />,
};

/** Renders a snippet, turning the server's highlight markers into <mark>s (no HTML parsing). */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${HIGHLIGHT_START}[^${HIGHLIGHT_END}]*${HIGHLIGHT_END})`));
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith(HIGHLIGHT_START) ? (
          <mark key={i} className="rounded-sm bg-accent-soft px-0.5 font-medium text-accent">
            {part.slice(1, -1)}
          </mark>
        ) : (
          part.replace(/\s+/g, ' ')
        ),
      )}
    </>
  );
}

interface Item {
  key: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  to: string;
  /** Runs instead of navigating. */
  action?: () => void;
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const workspaceId = useWorkspaceId();
  const navigate = useNavigate();
  const projects = useProjects();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = useDebounced(query.trim(), 150);
  const aiEnabled = useAiEnabled();
  const answer = useAiStream();
  const startAnswer = answer.start;
  const [asked, setAsked] = useState<string | null>(null);

  const search = useQuery({
    queryKey: ['search', workspaceId, q],
    queryFn: () =>
      api(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}&limit=12`, searchResponse),
    enabled: open && q.length > 0,
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });

  const base = `/w/${workspaceId}`;

  const items: Item[] = useMemo(() => {
    const linkFor = (r: SearchResult) =>
      r.type === 'doc'
        ? `${base}/docs/${r.id}`
        : r.type === 'meeting'
          ? `${base}/calendar?meeting=${r.id}`
          : `${base}/p/${r.projectId}?task=${r.taskId}`;
    if (!query.trim()) {
      return [
        { key: 'inbox', icon: <Bell className="size-4" />, title: 'Inbox', to: `${base}/inbox` },
        { key: 'docs', icon: <FileText className="size-4" />, title: 'Docs', to: `${base}/docs` },
        {
          key: 'calendar',
          icon: <CalendarDays className="size-4" />,
          title: 'Calendar',
          to: `${base}/calendar`,
        },
        {
          key: 'members',
          icon: <Users className="size-4" />,
          title: 'Members',
          to: `${base}/members`,
        },
        {
          key: 'settings',
          icon: <Settings className="size-4" />,
          title: 'Settings',
          to: `${base}/settings`,
        },
        ...(projects.data ?? []).map((p) => ({
          key: `project:${p.id}`,
          icon: <FolderKanban className="size-4" />,
          title: p.name,
          subtitle: 'Project',
          to: `${base}/p/${p.id}`,
        })),
      ];
    }
    const question = query.trim();
    const ask: Item[] =
      aiEnabled && question.length >= 2
        ? [
            {
              key: 'ask',
              icon: <Sparkles className="size-4 text-accent" />,
              title: `Ask AI: “${question}”`,
              subtitle: 'Answer from your workspace, with sources',
              to: '',
              action: () => {
                setAsked(question);
                void startAnswer(`/workspaces/${workspaceId}/ai/ask`, { question });
              },
            },
          ]
        : [];
    return [
      ...(search.data?.results ?? []).map((r) => ({
        key: `${r.type}:${r.id}`,
        icon: typeIcon[r.type],
        title: r.title,
        subtitle: r.snippet ? <Highlighted text={r.snippet} /> : undefined,
        to: linkFor(r),
      })),
      ...ask,
    ];
  }, [query, search.data, projects.data, base, aiEnabled, startAnswer, workspaceId]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    if (item.action) return item.action();
    onOpenChange(false);
    navigate(item.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(
        0,
        Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)),
      );
      setActive(next);
      listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[active]);
    }
  };

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setQuery('');
          setAsked(null);
          answer.reset();
        }
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] dark:bg-black/50" />
        <RadixDialog.Content
          onKeyDown={onKeyDown}
          className="animate-pop fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-raised shadow-pop"
        >
          <RadixDialog.Title className="sr-only">Search</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">
            Search tasks, docs, comments and meetings
          </RadixDialog.Description>
          <div className="flex items-center gap-2.5 border-b border-border px-4">
            <Search className="size-4 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                if (asked !== null) {
                  setAsked(null);
                  answer.reset();
                }
              }}
              placeholder="Search tasks, docs, comments, meetings…"
              className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-subtle"
            />
            {search.isFetching && <Spinner className="size-4 text-fg-subtle" />}
          </div>

          {asked !== null ? (
            <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
              <button
                onClick={() => {
                  setAsked(null);
                  answer.reset();
                }}
                className="mb-2 flex items-center gap-1 text-[12px] text-fg-subtle hover:text-fg"
              >
                <ArrowLeft className="size-3.5" /> Back to results
              </button>
              <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-accent">
                <Sparkles className="size-3.5" /> Answer
                {answer.status === 'streaming' && <Spinner className="size-3" />}
              </div>
              {answer.text ? (
                <AiText text={answer.text} sources={answer.sources} workspaceId={workspaceId} />
              ) : (
                answer.status === 'streaming' && (
                  <p className="text-[13px] text-fg-subtle">Searching your workspace…</p>
                )
              )}
              {answer.status === 'error' && (
                <p className="mt-2 text-[13px] text-danger">{answer.error}</p>
              )}
              {answer.sources.length > 0 && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="mb-1.5 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
                    Sources
                  </p>
                  <ol className="space-y-0.5">
                    {answer.sources.map((s) => (
                      <li key={s.n}>
                        <button
                          onClick={() => {
                            onOpenChange(false);
                            navigate(sourceLink(workspaceId, s));
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-hover"
                        >
                          <span className="w-4 text-right text-fg-subtle">{s.n}</span>
                          <span className="text-fg-muted">{typeIcon[s.type]}</span>
                          <span className="truncate">{s.title}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <p className="mt-3 text-[11px] text-fg-subtle">
                AI-generated from content you can access. Check the sources.
              </p>
            </div>
          ) : (
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
              {items.map((item, i) => (
                <button
                  key={item.key}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left',
                    i === active && 'bg-hover',
                  )}
                >
                  <span className="mt-0.5 text-fg-muted">{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{item.title}</span>
                    {item.subtitle && (
                      <span className="mt-0.5 line-clamp-2 block text-[12px] text-fg-muted">
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                </button>
              ))}
              {query.trim() && search.data && items.length === 0 && (
                <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">
                  No results for “{query.trim()}”
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-fg-subtle">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> to move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Enter</Kbd> to open
            </span>
            <span className="flex-1" />
            {search.data && (
              <span className="flex items-center gap-1">
                <Sparkles className="size-3" />
                {search.data.semantic ? 'Keyword + semantic' : 'Keyword search'}
              </span>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

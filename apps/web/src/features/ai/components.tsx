import { Sparkles, X } from 'lucide-react';
import Markdown from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import { cn } from '../../lib/cn';
import type { AiSource, useAiStream } from './hooks';

/** Where a cited source opens in the app. */
export function sourceLink(workspaceId: string, s: AiSource) {
  const base = `/w/${workspaceId}`;
  if (s.type === 'doc') return `${base}/docs/${s.id}`;
  if (s.type === 'meeting') return `${base}/calendar?meeting=${s.id}`;
  return `${base}/p/${s.projectId}?task=${s.taskId}`;
}

/**
 * AI-written Markdown. Citations like [2] become links to their source when `sources` are
 * given; the text is rendered as Markdown only (raw HTML is never interpreted).
 */
export function AiText({
  text,
  sources,
  workspaceId,
  className,
}: {
  text: string;
  sources?: AiSource[];
  workspaceId?: string;
  className?: string;
}) {
  const byN = new Map((sources ?? []).map((s) => [s.n, s]));
  const withCitations =
    sources && workspaceId
      ? text.replace(/\[(\d+)\](?!\()/g, (m, n: string) => (byN.has(+n) ? `[${n}](#cite-${n})` : m))
      : text;
  return (
    <div className={cn('doc-prose ai-prose', className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const cite = href?.match(/^#cite-(\d+)$/);
            const source = cite ? byN.get(+cite[1]!) : undefined;
            if (source && workspaceId) {
              return (
                <Link to={sourceLink(workspaceId, source)} title={source.title} className="ai-cite">
                  {source.n}
                </Link>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {withCitations}
      </Markdown>
    </div>
  );
}

export function SummarizeButton({
  onClick,
  busy,
  label = 'Summarize',
}: {
  onClick: () => void;
  busy?: boolean;
  label?: string;
}) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} disabled={busy}>
      {busy ? <Spinner className="size-3.5" /> : <Sparkles className="size-3.5 text-accent" />}
      {label}
    </Button>
  );
}

/** A streamed summary (or answer), with progress, errors and a close button. */
export function SummaryCard({
  title = 'AI summary',
  stream,
  onClose,
  className,
}: {
  title?: string;
  stream: ReturnType<typeof useAiStream> & { run?: () => void };
  onClose: () => void;
  className?: string;
}) {
  if (stream.status === 'idle') return null;
  return (
    <section
      aria-live="polite"
      className={cn(
        'animate-pop rounded-xl border border-accent/25 bg-accent-soft/40 p-4',
        className,
      )}
    >
      <header className="mb-2 flex items-center gap-2 text-[12px] font-medium text-accent">
        <Sparkles className="size-3.5" />
        {title}
        {stream.status === 'streaming' && <Spinner className="size-3" />}
        {stream.status === 'done' && stream.cached && (
          <span className="font-normal text-fg-subtle">· unchanged since last summary</span>
        )}
        <span className="flex-1" />
        <button
          onClick={onClose}
          aria-label="Close summary"
          className="rounded p-0.5 text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      </header>
      {stream.text ? (
        <AiText text={stream.text} />
      ) : (
        stream.status === 'streaming' && (
          <p className="text-[13px] text-fg-subtle">Reading and summarizing…</p>
        )
      )}
      {stream.status === 'error' && (
        <div className="mt-2 flex items-center gap-2 text-[13px] text-danger">
          {stream.error}
          {stream.run && (
            <Button size="sm" variant="ghost" onClick={stream.run}>
              Try again
            </Button>
          )}
        </div>
      )}
      <p className="mt-3 text-[11px] text-fg-subtle">
        AI-generated from content you can access. Check important details.
      </p>
    </section>
  );
}

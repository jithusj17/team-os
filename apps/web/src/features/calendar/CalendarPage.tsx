import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { canInWorkspace, type Meeting, type RsvpResponse } from '@team-os/shared';
import { Button } from '../../components/ui/button';
import { Avatar } from '../../components/ui/misc';
import { Picker } from '../../components/ui/picker';
import { PageSpinner } from '../../components/ui/spinner';
import { cn } from '../../lib/cn';
import { ActionsDialog } from '../ai/ActionsDialog';
import { SummarizeButton, SummaryCard } from '../ai/components';
import { useAiEnabled, useSummary } from '../ai/hooks';
import { useCurrentUser } from '../auth/hooks';
import { useAllVisibleTasks } from '../docs/hooks';
import { useMemberMap, useWorkspace, useWorkspaceId } from '../workspaces/hooks';
import {
  addDays,
  layoutDay,
  sameDay,
  startOfWeek,
  useMeeting,
  useMeetingMutations,
  useMeetings,
} from './hooks';
import { MeetingDialog } from './MeetingDialog';

const HOUR_PX = 48;
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const rangeFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const longDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

const responseLabel: Record<RsvpResponse, string> = {
  pending: 'Awaiting reply',
  accepted: 'Going',
  tentative: 'Maybe',
  declined: 'Not going',
};

function MeetingPanel({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const me = useCurrentUser();
  const workspaceId = useWorkspaceId();
  const navigate = useNavigate();
  const members = useMemberMap();
  const { data: m } = useMeeting(meetingId);
  const { rsvp, remove, link, notes } = useMeetingMutations();
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const tasks = useAllVisibleTasks(linking);
  const aiEnabled = useAiEnabled();
  const summary = useSummary('meeting', meetingId);
  const [extracting, setExtracting] = useState(false);

  if (!m) {
    return (
      <aside className="animate-slide-in fixed inset-y-0 right-0 z-30 w-full border-l border-border bg-raised shadow-pop sm:w-[440px]">
        <PageSpinner />
      </aside>
    );
  }
  const mine = m.attendees.find((a) => a.userId === me.id);

  const openNotes = () =>
    notes.mutate(m.id, { onSuccess: ({ docId }) => navigate(`/w/${workspaceId}/docs/${docId}`) });

  return (
    <aside className="animate-slide-in fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-border bg-raised shadow-pop sm:w-[440px]">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-4">
        <CalendarDays className="size-4 text-fg-muted" />
        <span className="flex-1" />
        {m.canEdit && (
          <>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Edit meeting"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Delete meeting"
              onClick={() =>
                confirm(`Delete "${m.title}"?`) && remove.mutate(m.id, { onSuccess: onClose })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </>
        )}
        <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div>
          <h2 className="text-[18px] font-semibold">{m.title}</h2>
          <div className="mt-2 space-y-1.5 text-[13px] text-fg-muted">
            <div className="flex items-center gap-2">
              <Clock className="size-3.5" />
              {longDateFmt.format(m.startsAt)} · {timeFmt.format(m.startsAt)} –{' '}
              {timeFmt.format(m.endsAt)}
            </div>
            {m.location && (
              <div className="flex items-center gap-2">
                <MapPin className="size-3.5" />
                {/^https?:\/\//.test(m.location) ? (
                  <a
                    href={m.location}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-accent underline"
                  >
                    {m.location}
                  </a>
                ) : (
                  m.location
                )}
              </div>
            )}
          </div>
          {m.description && (
            <p className="mt-3 text-[13px] leading-relaxed whitespace-pre-wrap">{m.description}</p>
          )}
        </div>

        {mine && (
          <div>
            <div className="mb-2 text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">
              Going?
            </div>
            <div className="flex gap-1.5">
              {(['accepted', 'tentative', 'declined'] as const).map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={mine.response === r ? 'primary' : 'secondary'}
                  onClick={() => rsvp.mutate({ id: m.id, response: r })}
                >
                  {mine.response === r && <Check className="size-3.5" />}
                  {responseLabel[r]}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">
            Attendees · {m.attendees.length}
          </div>
          <ul className="space-y-1.5">
            {m.attendees.map((a) => {
              const p = members.get(a.userId);
              return (
                <li key={a.userId} className="flex items-center gap-2.5 text-[13px]">
                  <Avatar
                    user={{ id: a.userId, name: p?.name ?? '?', avatarUrl: p?.avatarUrl }}
                    size={24}
                  />
                  <span className="flex-1">
                    {p?.name ?? 'Someone'}
                    {a.userId === m.organizerId && (
                      <span className="text-fg-subtle"> · organizer</span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'text-[12px]',
                      a.response === 'accepted'
                        ? 'text-success'
                        : a.response === 'declined'
                          ? 'text-danger'
                          : 'text-fg-subtle',
                    )}
                  >
                    {responseLabel[a.response]}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <div className="mb-2 text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">
            Notes
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button onClick={openNotes} loading={notes.isPending}>
              <FileText className="size-3.5" />{' '}
              {m.notesDocId ? 'Open meeting notes' : 'Start meeting notes'}
            </Button>
            {aiEnabled && (
              <>
                <SummarizeButton busy={summary.status === 'streaming'} onClick={summary.run} />
                {m.notesDocId && (
                  <Button size="sm" variant="ghost" onClick={() => setExtracting(true)}>
                    <Wand2 className="size-3.5 text-accent" /> Action items → tasks
                  </Button>
                )}
              </>
            )}
          </div>
          <SummaryCard stream={summary} onClose={summary.reset} className="mt-3" />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold tracking-wide text-fg-subtle uppercase">
              Linked tasks
            </span>
            {m.canEdit && (
              <span onPointerDown={() => setLinking(true)}>
                <Picker
                  value={null}
                  align="end"
                  placeholder="Find a task…"
                  onChange={(taskId) => link.mutate({ id: m.id, taskId, link: true })}
                  options={tasks
                    .filter((t) => !m.linkedTasks.some((l) => l.id === t.id))
                    .map((t) => ({ value: t.id, label: `${t.key} ${t.title}` }))}
                  trigger={
                    <Button size="sm" variant="ghost">
                      <Link2 className="size-3.5" /> Link
                    </Button>
                  }
                />
              </span>
            )}
          </div>
          {m.linkedTasks.length === 0 && (
            <p className="text-[13px] text-fg-subtle">No linked tasks.</p>
          )}
          {m.linkedTasks.map((t) => (
            <div
              key={t.id}
              className="group flex h-8 items-center gap-2 rounded-md px-1.5 hover:bg-hover"
            >
              <Link
                to={`/w/${workspaceId}/p/${t.projectId}?task=${t.id}`}
                className="flex min-w-0 flex-1 items-center gap-2 text-[13px]"
              >
                <span className="font-mono text-[11px] text-fg-subtle">{t.key}</span>
                <span className="truncate">{t.title}</span>
              </Link>
              {m.canEdit && (
                <button
                  aria-label={`Unlink ${t.key}`}
                  onClick={() => link.mutate({ id: m.id, taskId: t.id, link: false })}
                  className="text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-fg"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      {editing && <MeetingDialog open onOpenChange={setEditing} existing={m} />}
      {aiEnabled && (
        <ActionsDialog
          open={extracting}
          onOpenChange={setExtracting}
          workspaceId={workspaceId}
          projectId={m.projectId}
          source={{ type: 'meeting', id: m.id }}
          defaultInstruction="Create a task for each action item in the meeting notes, with owners and due dates where stated"
          title="Turn action items into tasks"
        />
      )}
    </aside>
  );
}

export function CalendarPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState<Date | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const weekEnd = addDays(weekStart, 7);
  const meetings = useMeetings(weekStart, weekEnd, mine);
  const openId = params.get('meeting');
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const today = new Date();
  const canCreate =
    workspace.data && canInWorkspace(workspace.data.role, { action: 'project:create' });

  // Start the view at the working day once the grid has rendered.
  const loaded = !!meetings.data;
  useEffect(() => {
    if (loaded) scroller.current?.scrollTo({ top: HOUR_PX * 7.5 });
  }, [loaded]);

  const open = (m: Meeting | null) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (m) next.set('meeting', m.id);
      else next.delete('meeting');
      return next;
    });

  const nowTop = (today.getHours() + today.getMinutes() / 60) * HOUR_PX;

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-2">
        <h1 className="text-[15px] font-semibold">Calendar</h1>
        <div className="ml-3 flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Previous week"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Today
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Next week"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <span className="text-[14px] font-medium">{rangeFmt.format(weekStart)}</span>
        <span className="flex-1" />
        <div className="flex rounded-lg border border-border bg-muted p-0.5">
          {[
            [false, 'Everyone'],
            [true, 'My meetings'],
          ].map(([value, label]) => (
            <button
              key={String(value)}
              onClick={() => setMine(value as boolean)}
              className={cn(
                'h-6 rounded-md px-2.5 text-[12px] font-medium',
                mine === value ? 'bg-surface shadow-sm' : 'text-fg-muted hover:text-fg',
              )}
            >
              {label as string}
            </button>
          ))}
        </div>
        {canCreate && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => setCreating(new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000))}
          >
            <Plus className="size-3.5" /> New meeting
          </Button>
        )}
      </header>

      {!meetings.data ? (
        <PageSpinner />
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-[760px]">
            <div className="sticky top-0 z-10 grid grid-cols-[56px_repeat(7,1fr)] border-b border-border bg-bg/95 backdrop-blur">
              <div />
              {days.map((d) => (
                <div key={d.toISOString()} className="py-2 text-center">
                  <div className="text-[11px] font-medium text-fg-subtle uppercase">
                    {dayFmt.format(d)}
                  </div>
                  <div
                    className={cn(
                      'mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-[14px] font-semibold',
                      sameDay(d, today) && 'bg-accent text-accent-fg',
                    )}
                  >
                    {d.getDate()}
                  </div>
                </div>
              ))}
            </div>

            <div
              className="relative grid grid-cols-[56px_repeat(7,1fr)]"
              style={{ height: HOUR_PX * 24 }}
            >
              <div className="relative">
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute right-2 -translate-y-1/2 text-[11px] text-fg-subtle"
                    style={{ top: h * HOUR_PX }}
                  >
                    {h === 0 ? '' : hourFmt.format(new Date(2000, 0, 1, h))}
                  </div>
                ))}
              </div>
              {days.map((day) => {
                const dayMeetings = meetings.data.filter((m) => sameDay(m.startsAt, day));
                const layout = layoutDay(dayMeetings);
                return (
                  <div
                    key={day.toISOString()}
                    className="relative border-l border-border"
                    onDoubleClick={(e) => {
                      if (!canCreate) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const minutes = Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30;
                      const start = new Date(day);
                      start.setMinutes(minutes);
                      setCreating(start);
                    }}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        className="absolute inset-x-0 border-t border-border/60"
                        style={{ top: h * HOUR_PX }}
                      />
                    ))}
                    {sameDay(day, today) && (
                      <div
                        className="absolute inset-x-0 z-10 flex items-center"
                        style={{ top: nowTop }}
                      >
                        <span className="-ml-1 size-2 rounded-full bg-danger" />
                        <span className="h-px flex-1 bg-danger" />
                      </div>
                    )}
                    {dayMeetings.map((m) => {
                      const { lane, lanes } = layout.get(m.id)!;
                      const top = (m.startsAt.getHours() + m.startsAt.getMinutes() / 60) * HOUR_PX;
                      const height = Math.max(
                        22,
                        ((m.endsAt.getTime() - m.startsAt.getTime()) / 3_600_000) * HOUR_PX - 2,
                      );
                      return (
                        <button
                          key={m.id}
                          onClick={() => open(m)}
                          className={cn(
                            'absolute overflow-hidden rounded-md border-l-[3px] border-accent bg-accent-soft px-1.5 py-1 text-left text-[12px] leading-tight transition-colors hover:brightness-95',
                            openId === m.id && 'ring-2 ring-accent',
                          )}
                          style={{
                            top,
                            height,
                            left: `calc(${(lane / lanes) * 100}% + 2px)`,
                            width: `calc(${100 / lanes}% - 4px)`,
                          }}
                        >
                          <div className="truncate font-medium text-fg">{m.title}</div>
                          {height > 34 && (
                            <div className="truncate text-fg-muted">
                              {timeFmt.format(m.startsAt)}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {openId && <MeetingPanel key={openId} meetingId={openId} onClose={() => open(null)} />}
      {creating && (
        <MeetingDialog
          open
          onOpenChange={(o) => !o && setCreating(null)}
          start={creating}
          onSaved={(m) => open(m)}
        />
      )}
    </div>
  );
}

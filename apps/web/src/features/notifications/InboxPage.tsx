import {
  AtSign,
  Bell,
  CalendarClock,
  CheckCheck,
  CircleDot,
  MessageSquare,
  Unlock,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Notification, NotificationType } from '@team-os/shared';
import { Button } from '../../components/ui/button';
import { Avatar, EmptyState } from '../../components/ui/misc';
import { PageSpinner } from '../../components/ui/spinner';
import { cn } from '../../lib/cn';
import { timeAgo } from '../../lib/format';
import { useMemberMap, useWorkspace, useWorkspaceId } from '../workspaces/hooks';
import { useInbox, useMarkRead } from './hooks';

const icons: Record<NotificationType, React.ReactNode> = {
  assigned: <UserPlus className="size-3.5" />,
  mentioned: <AtSign className="size-3.5" />,
  commented: <MessageSquare className="size-3.5" />,
  status_changed: <CircleDot className="size-3.5" />,
  blocker_resolved: <Unlock className="size-3.5" />,
  due_soon: <CalendarClock className="size-3.5" />,
};

function headline(n: Notification, actor: string) {
  switch (n.type) {
    case 'assigned':
      return `${actor} assigned you`;
    case 'mentioned':
      return `${actor} mentioned you`;
    case 'commented':
      return `${actor} commented`;
    case 'status_changed':
      return `${actor} moved it to ${n.data.statusName ?? 'a new status'}`;
    case 'blocker_resolved':
      return `${n.data.blockerKey ?? 'A blocker'} is done — you’re unblocked`;
    case 'due_soon':
      return `Due ${n.data.dueDate ?? 'soon'}`;
  }
}

export function InboxPage() {
  const workspaceId = useWorkspaceId();
  const workspace = useWorkspace();
  const inbox = useInbox();
  const markRead = useMarkRead();
  const members = useMemberMap();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);

  if (!inbox.data) return <PageSpinner />;
  // The inbox is per user across workspaces; show this workspace's notifications here.
  const items = inbox.data.items.filter(
    (n) => n.workspaceId === workspaceId && (!unreadOnly || !n.readAt),
  );

  const open = (n: Notification) => {
    if (!n.readAt) markRead.mutate([n.id]);
    if (n.projectId && n.taskId) navigate(`/w/${workspaceId}/p/${n.projectId}?task=${n.taskId}`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
            <p className="mt-1 text-[13px] text-fg-muted">
              {inbox.data.unreadCount ? `${inbox.data.unreadCount} unread` : 'You’re all caught up'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border bg-muted p-0.5">
              {[
                [false, 'All'],
                [true, 'Unread'],
              ].map(([value, label]) => (
                <button
                  key={String(value)}
                  onClick={() => setUnreadOnly(value as boolean)}
                  className={cn(
                    'h-6 rounded-md px-2.5 text-[12px] font-medium',
                    unreadOnly === value ? 'bg-surface shadow-sm' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {label as string}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              disabled={!inbox.data.unreadCount}
              onClick={() => markRead.mutate('all')}
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border">
            <EmptyState
              icon={<Bell className="size-5" />}
              title={unreadOnly ? 'No unread notifications' : 'Nothing here yet'}
              description={`You’ll be notified when someone assigns you a task or mentions you in ${workspace.data?.name ?? 'this workspace'}.`}
            />
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
            {items.map((n) => {
              const actor = n.actorId ? members.get(n.actorId) : undefined;
              return (
                <li key={n.id}>
                  <button
                    onClick={() => open(n)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover/60',
                      !n.readAt && 'bg-accent-soft/40',
                    )}
                  >
                    <span className="relative mt-0.5">
                      <Avatar
                        user={
                          actor
                            ? { id: actor.userId, name: actor.name, avatarUrl: actor.avatarUrl }
                            : null
                        }
                        size={28}
                      />
                      <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border border-border bg-raised text-fg-muted">
                        {icons[n.type]}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px]">
                        <span className={cn(!n.readAt && 'font-semibold')}>
                          {headline(n, actor?.name ?? 'Someone')}
                        </span>
                        <span className="text-fg-subtle"> · {timeAgo(n.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-fg-muted">
                        <span className="font-mono text-[12px] text-fg-subtle">
                          {n.data.taskKey}
                        </span>{' '}
                        {n.data.taskTitle}
                      </span>
                      {n.data.excerpt && (
                        <span className="mt-1 block truncate text-[12px] text-fg-subtle">
                          “{n.data.excerpt}”
                        </span>
                      )}
                    </span>
                    {!n.readAt && (
                      <span
                        className="mt-2 size-2 shrink-0 rounded-full bg-accent"
                        aria-label="Unread"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

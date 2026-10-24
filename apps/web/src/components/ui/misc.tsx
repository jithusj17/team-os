import * as RadixTooltip from '@radix-ui/react-tooltip';
import { cn } from '../../lib/cn';
import { initials } from '../../lib/format';

// Avatar colors are derived from the user id, so a person keeps the same color everywhere.
const avatarColors = [
  'bg-indigo-500',
  'bg-emerald-500',
  'bg-fuchsia-500',
  'bg-rose-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-teal-500',
  'bg-lime-600',
];

function colorFor(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export function Avatar({
  user,
  size = 20,
  className,
}: {
  user: { id: string; name: string; avatarUrl?: string | null } | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.42) };
  if (!user) {
    return (
      <span
        style={style}
        className={cn(
          'inline-block shrink-0 rounded-full border border-dashed border-fg-subtle',
          className,
        )}
      />
    );
  }
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name}
        style={style}
        className={cn('inline-block shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      style={style}
      title={user.name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        colorFor(user.id),
        className,
      )}
    >
      {initials(user.name)}
    </span>
  );
}

export function Badge({
  children,
  className,
  color,
}: {
  children: React.ReactNode;
  className?: string;
  color?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 text-[11px] font-medium text-fg-muted',
        className,
      )}
    >
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-sans text-[11px] text-fg-muted">
      {children}
    </kbd>
  );
}

export function Tooltip({
  content,
  children,
}: {
  content: React.ReactNode;
  children: React.ReactElement;
}) {
  return (
    <RadixTooltip.Root delayDuration={400}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={6}
          className="animate-pop z-50 rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-pop"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-border bg-surface text-fg-muted shadow-card">
        {icon}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

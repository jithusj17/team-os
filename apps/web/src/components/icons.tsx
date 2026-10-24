import type { StatusCategory, TaskPriority } from '@team-os/shared';
import { cn } from '../lib/cn';

/** Linear-style status glyph: dashed (backlog), empty, half, check, or cross. */
export function StatusIcon({
  category,
  color,
  className,
}: {
  category: StatusCategory;
  color: string;
  className?: string;
}) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 14 14',
    className: cn('shrink-0', className),
  };
  switch (category) {
    case 'backlog':
      return (
        <svg {...common}>
          <circle
            cx="7"
            cy="7"
            r="5.5"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />
        </svg>
      );
    case 'todo':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="1.5" />
        </svg>
      );
    case 'in_progress':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill={color} />
        </svg>
      );
    case 'done':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6.25" fill={color} />
          <path
            d="M4.5 7.2 6.2 8.8 9.6 5.3"
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'canceled':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6.25" fill={color} />
          <path d="m5 5 4 4m0-4-4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

/** Signal-bar priority glyph; urgent is a filled alert square. */
export function PriorityIcon({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const cls = cn('shrink-0', className);
  if (priority === 'urgent') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className={cls}>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="#f2683c" />
        <path d="M7 4v3.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="9.75" r="0.9" fill="white" />
      </svg>
    );
  }
  if (priority === 'none') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className={cn(cls, 'text-fg-subtle')}>
        {[2.5, 6, 9.5].map((x) => (
          <rect key={x} x={x} y="6.25" width="2" height="1.5" rx="0.75" fill="currentColor" />
        ))}
      </svg>
    );
  }
  const level = { low: 1, medium: 2, high: 3 }[priority];
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className={cn(cls, 'text-fg-muted')}>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2 + i * 3.5}
          y={9 - i * 3}
          width="2.5"
          height={3 + i * 3}
          rx="0.75"
          fill="currentColor"
          opacity={i < level ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}

export const priorityLabels: Record<TaskPriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-6', className)} aria-hidden>
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <path d="M7 8h10M12 8v9" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="17.5" cy="16.5" r="1.6" fill="white" />
    </svg>
  );
}

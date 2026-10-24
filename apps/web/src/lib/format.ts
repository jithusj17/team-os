const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dateYearFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** "just now", "5 min ago", "yesterday", "Mar 4". */
export function timeAgo(date: Date): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day');
  return formatDate(date);
}

export function formatDate(date: Date): string {
  return date.getFullYear() === new Date().getFullYear()
    ? dateFmt.format(date)
    : dateYearFmt.format(date);
}

/** A YYYY-MM-DD due date, read as a local calendar date. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function dueState(day: string | null, closed: boolean): 'overdue' | 'soon' | 'later' | null {
  if (!day || closed) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (parseDay(day).getTime() - today.getTime()) / 86_400_000;
  if (diff < 0) return 'overdue';
  if (diff <= 2) return 'soon';
  return 'later';
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

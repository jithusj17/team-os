import * as Popover from '@radix-ui/react-popover';
import { Check, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

export interface PickerOption<V extends string> {
  value: V;
  label: string;
  icon?: React.ReactNode;
  /** Extra text matched by search (e.g. an email). */
  keywords?: string;
}

/**
 * A searchable popover list, used for status, priority, assignee and label fields.
 * Single-select closes on pick; multi-select stays open and toggles.
 */
export function Picker<V extends string>({
  trigger,
  options,
  value,
  onChange,
  multiple,
  placeholder = 'Search…',
  align = 'start',
}: {
  trigger: React.ReactNode;
  options: PickerOption<V>[];
  value: V | V[] | null;
  onChange: (value: V) => void;
  multiple?: boolean;
  placeholder?: string;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter((o) => `${o.label} ${o.keywords ?? ''}`.toLowerCase().includes(q))
      : options;
  }, [options, query]);

  const selected = (v: V) => (Array.isArray(value) ? value.includes(v) : value === v);

  const pick = (option: PickerOption<V>) => {
    onChange(option.value);
    if (!multiple) setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? active + 1 : active - 1;
      const clamped = Math.max(0, Math.min(filtered.length - 1, next));
      setActive(clamped);
      listRef.current?.children[clamped]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && filtered[active]) {
      e.preventDefault();
      pick(filtered[active]);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setQuery('');
        setActive(0);
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={4}
          className="animate-pop z-50 w-60 overflow-hidden rounded-lg border border-border bg-raised shadow-pop"
          onKeyDown={onKeyDown}
          // React events bubble out of portals; keep picks from also clicking the row behind.
          onClick={(e) => e.stopPropagation()}
        >
          {options.length > 6 && (
            <div className="flex items-center gap-2 border-b border-border px-2.5">
              <Search className="size-3.5 text-fg-subtle" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder={placeholder}
                className="h-9 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
              />
            </div>
          )}
          <div ref={listRef} className="max-h-72 overflow-y-auto p-1" role="listbox">
            {filtered.length === 0 && (
              <div className="px-2 py-6 text-center text-[13px] text-fg-subtle">No matches</div>
            )}
            {filtered.map((option, i) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected(option.value)}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(option)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]',
                  i === active && 'bg-hover',
                )}
              >
                {option.icon && (
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {option.icon}
                  </span>
                )}
                <span className="flex-1 truncate">{option.label}</span>
                {selected(option.value) && <Check className="size-3.5 shrink-0 text-accent" />}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

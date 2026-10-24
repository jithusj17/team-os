import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

export const Menu = Dropdown.Root;
export const MenuTrigger = Dropdown.Trigger;

const panel =
  'animate-pop z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-raised p-1 shadow-pop';

export function MenuContent({
  children,
  align = 'start',
  className,
}: {
  children: React.ReactNode;
  align?: 'start' | 'end' | 'center';
  className?: string;
}) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={4}
        className={cn(panel, className)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </Dropdown.Content>
    </Dropdown.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger,
  checked,
  icon,
  disabled,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  checked?: boolean;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Dropdown.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px] outline-none select-none',
        'data-[disabled]:opacity-50 data-[highlighted]:bg-hover',
        danger ? 'text-danger' : 'text-fg',
      )}
    >
      {icon && (
        <span className="flex size-4 items-center justify-center text-fg-muted">{icon}</span>
      )}
      <span className="flex-1 truncate">{children}</span>
      {checked && <Check className="size-3.5 text-accent" />}
    </Dropdown.Item>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <Dropdown.Label className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
      {children}
    </Dropdown.Label>
  );
}

export const MenuSeparator = () => <Dropdown.Separator className="my-1 h-px bg-border" />;

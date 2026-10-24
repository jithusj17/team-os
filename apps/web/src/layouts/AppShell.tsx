import {
  Bell,
  CalendarDays,
  FileText,
  ChevronsUpDown,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { canInWorkspace } from '@team-os/shared';
import { Logo } from '../components/icons';
import { Button } from '../components/ui/button';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../components/ui/menu';
import { Avatar, Kbd } from '../components/ui/misc';
import { useCurrentUser, useSignOut } from '../features/auth/hooks';
import { useInbox } from '../features/notifications/hooks';
import { CreateProjectDialog } from '../features/projects/CreateProjectDialog';
import { useProjects } from '../features/projects/hooks';
import { CommandPalette } from '../features/search/CommandPalette';
import { useWorkspace, useWorkspaceId, useWorkspaces } from '../features/workspaces/hooks';
import { cn } from '../lib/cn';
import { useRealtime } from '../lib/realtime';
import { setTheme, useTheme } from '../lib/theme';

function NavItem({
  to,
  icon,
  children,
  badge,
  end,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  badge?: number;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors',
          isActive ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
        )
      }
    >
      <span className="flex size-4 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {!!badge && (
        <span className="rounded-full bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-accent-fg">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

function WorkspaceSwitcher() {
  const workspaceId = useWorkspaceId();
  const workspaces = useWorkspaces();
  const current = workspaces.data?.find((w) => w.id === workspaceId);
  const navigate = useNavigate();

  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover">
          <span className="flex size-6 items-center justify-center rounded-md bg-accent text-[12px] font-bold text-accent-fg">
            {current?.name[0]?.toUpperCase() ?? '·'}
          </span>
          <span className="flex-1 truncate text-[14px] font-semibold">{current?.name ?? '…'}</span>
          <ChevronsUpDown className="size-3.5 text-fg-subtle" />
        </button>
      </MenuTrigger>
      <MenuContent className="w-60">
        <MenuLabel>Workspaces</MenuLabel>
        {workspaces.data?.map((w) => (
          <MenuItem
            key={w.id}
            checked={w.id === workspaceId}
            onSelect={() => navigate(`/w/${w.id}`)}
          >
            {w.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<Plus className="size-3.5" />} onSelect={() => navigate('/new')}>
          Create workspace
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function UserMenu() {
  const user = useCurrentUser();
  const signOut = useSignOut();
  const theme = useTheme();
  const { connected } = useRealtime();
  const themes = [
    { value: 'system', label: 'System', icon: <Monitor className="size-3.5" /> },
    { value: 'light', label: 'Light', icon: <Sun className="size-3.5" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="size-3.5" /> },
  ] as const;

  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-hover">
          <span className="relative">
            <Avatar user={user} size={24} />
            <span
              title={connected ? 'Live updates on' : 'Reconnecting…'}
              className={cn(
                'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar',
                connected ? 'bg-success' : 'bg-fg-subtle',
              )}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{user.name}</span>
            <span className="block truncate text-[11px] text-fg-subtle">{user.email}</span>
          </span>
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-56">
        <MenuLabel>Theme</MenuLabel>
        {themes.map((t) => (
          <MenuItem
            key={t.value}
            icon={t.icon}
            checked={theme === t.value}
            onSelect={() => setTheme(t.value)}
          >
            {t.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<LogOut className="size-3.5" />} onSelect={signOut}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function Sidebar({ onNavigate, onSearch }: { onNavigate?: () => void; onSearch: () => void }) {
  const workspaceId = useWorkspaceId();
  const workspace = useWorkspace();
  const projects = useProjects();
  const inbox = useInbox();
  const [creating, setCreating] = useState(false);
  const role = workspace.data?.role;
  const base = `/w/${workspaceId}`;

  return (
    <div
      className="flex h-full flex-col gap-1 p-2"
      onClick={(e) => (e.target as HTMLElement).closest('a') && onNavigate?.()}
    >
      <WorkspaceSwitcher />
      <button
        onClick={() => {
          onNavigate?.();
          onSearch();
        }}
        className="mt-2 flex h-8 items-center gap-2.5 rounded-md border border-border bg-surface px-2 text-[13px] text-fg-subtle shadow-sm hover:text-fg-muted"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <nav className="mt-2 space-y-0.5">
        <NavItem
          to={`${base}/inbox`}
          icon={<Bell className="size-4" />}
          badge={inbox.data?.unreadCount}
        >
          Inbox
        </NavItem>
        <NavItem to={`${base}/docs`} icon={<FileText className="size-4" />}>
          Docs
        </NavItem>
        <NavItem to={`${base}/calendar`} icon={<CalendarDays className="size-4" />}>
          Calendar
        </NavItem>
        {role && canInWorkspace(role, { action: 'member:list' }) && (
          <NavItem to={`${base}/members`} icon={<Users className="size-4" />}>
            Members
          </NavItem>
        )}
        <NavItem to={`${base}/settings`} icon={<Settings className="size-4" />}>
          Settings
        </NavItem>
      </nav>

      <div className="mt-5 flex items-center justify-between px-2">
        <span className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
          Projects
        </span>
        {role && canInWorkspace(role, { action: 'project:create' }) && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="New project"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-3.5" />
          </Button>
        )}
      </div>
      <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto">
        {projects.data?.map((p) => (
          <NavItem
            key={p.id}
            to={`${base}/p/${p.id}`}
            icon={
              <span className="flex size-4 items-center justify-center rounded bg-accent-soft text-[9px] font-bold text-accent">
                {p.key.slice(0, 2)}
              </span>
            }
          >
            {p.name}
          </NavItem>
        ))}
        {projects.data?.length === 0 && (
          <p className="px-2 py-1 text-[12px] text-fg-subtle">No projects yet.</p>
        )}
      </nav>

      <UserMenu />
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  // The mobile sidebar closes itself when a link in it is clicked (see Sidebar onNavigate).
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Ctrl+K / Cmd+K opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-sidebar md:block">
        <Sidebar onSearch={() => setSearchOpen(true)} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="animate-slide-in absolute inset-y-0 left-0 w-64 border-r border-border bg-sidebar shadow-pop">
            <Sidebar onNavigate={() => setMobileOpen(false)} onSearch={() => setSearchOpen(true)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 items-center gap-2 border-b border-border px-3 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <MenuIcon className="size-4" />
          </Button>
          <Logo className="size-5" />
        </div>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      </div>
    </div>
  );
}

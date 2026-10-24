import { Copy, MailPlus, MoreHorizontal, UserMinus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  canInWorkspace,
  invitableRoles,
  workspaceRoles,
  type InvitableRole,
  type WorkspaceRole,
} from '@team-os/shared';
import { Button } from '../../components/ui/button';
import { Dialog, DialogFooter } from '../../components/ui/dialog';
import { Field, Input } from '../../components/ui/input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu';
import { Avatar, Badge } from '../../components/ui/misc';
import { Picker } from '../../components/ui/picker';
import { PageSpinner } from '../../components/ui/spinner';
import { errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useCurrentUser } from '../auth/hooks';
import {
  useChangeRole,
  useInvite,
  useInvites,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useWorkspace,
} from './hooks';

const roleLabel = (r: WorkspaceRole) => r[0]!.toUpperCase() + r.slice(1);

const roleHelp: Record<WorkspaceRole, string> = {
  owner: 'Full control, including deleting the workspace',
  admin: 'Manages members, invites and every project',
  member: 'Creates projects and works in workspace projects',
  guest: 'Only sees projects they are added to',
};

function InviteDialog({
  open,
  onOpenChange,
  myRole,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  myRole: WorkspaceRole;
}) {
  const invite = useInvite();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('member');
  const [link, setLink] = useState<string | null>(null);
  const allowedRoles = invitableRoles.filter((r) =>
    canInWorkspace(myRole, { action: 'invite:create', role: r }),
  );

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setEmail('');
      setLink(null);
      invite.reset();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Invite to workspace"
      description="They’ll get an email with a link to join."
    >
      {link ? (
        <div className="space-y-3">
          <p className="text-[13px] text-fg-muted">
            Invite created for <span className="font-medium text-fg">{email}</span>. Email delivery
            isn’t configured yet, so share this link with them:
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
              className="font-mono text-[12px]"
            />
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(link);
                toast.success('Invite link copied');
              }}
            >
              <Copy className="size-3.5" /> Copy
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setLink(null)}>Invite another</Button>
            <Button variant="primary" onClick={() => close(false)}>
              Done
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate({ email, role }, { onSuccess: (res) => setLink(res.acceptUrl) });
          }}
        >
          <Field label="Email" error={invite.error ? errorMessage(invite.error) : null}>
            <Input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
            />
          </Field>
          <div className="space-y-1.5">
            <span className="text-[13px] font-medium">Role</span>
            <div className="grid gap-1.5">
              {allowedRoles.map((r) => (
                <label
                  key={r}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-2.5 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                >
                  <input
                    type="radio"
                    name="role"
                    checked={role === r}
                    onChange={() => setRole(r)}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="block text-[13px] font-medium">{roleLabel(r)}</span>
                    <span className="block text-[12px] text-fg-muted">{roleHelp[r]}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={invite.isPending}>
              Send invite
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}

export function MembersPage() {
  const me = useCurrentUser();
  const workspace = useWorkspace();
  const role = workspace.data?.role;
  const members = useMembers();
  const canManageInvites = !!role && canInWorkspace(role, { action: 'invite:list' });
  const invites = useInvites(canManageInvites);
  const changeRole = useChangeRole();
  const removeMember = useRemoveMember();
  const revoke = useRevokeInvite();
  const [inviting, setInviting] = useState(false);
  const onError = (err: unknown) => toast.error(errorMessage(err));

  if (!members.data || !role) return <PageSpinner />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Members</h1>
            <p className="mt-1 text-[13px] text-fg-muted">
              {members.data.length} {members.data.length === 1 ? 'person' : 'people'} in{' '}
              {workspace.data?.name}
            </p>
          </div>
          {canInWorkspace(role, { action: 'invite:create', role: 'member' }) && (
            <Button variant="primary" onClick={() => setInviting(true)}>
              <MailPlus className="size-3.5" /> Invite people
            </Button>
          )}
        </div>

        <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface shadow-card">
          {members.data.map((m) => {
            const isMe = m.userId === me.id;
            const assignable = workspaceRoles.filter((r) =>
              canInWorkspace(role, {
                action: 'member:change-role',
                targetRole: m.role,
                newRole: r,
              }),
            );
            const canRemove = canInWorkspace(role, {
              action: 'member:remove',
              targetRole: m.role,
              isSelf: isMe,
            });
            return (
              <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                <Avatar user={{ id: m.userId, name: m.name, avatarUrl: m.avatarUrl }} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {m.name} {isMe && <span className="font-normal text-fg-subtle">(you)</span>}
                  </span>
                  <span className="block truncate text-[12px] text-fg-subtle">{m.email}</span>
                </span>
                <span className="hidden text-[12px] text-fg-subtle sm:block">
                  Joined {formatDate(m.joinedAt)}
                </span>
                {assignable.length > 1 ? (
                  <Picker
                    value={m.role}
                    align="end"
                    onChange={(r) =>
                      r !== m.role && changeRole.mutate({ userId: m.userId, role: r }, { onError })
                    }
                    options={assignable.map((r) => ({ value: r, label: roleLabel(r) }))}
                    trigger={
                      <Button size="sm" variant="ghost">
                        {roleLabel(m.role)}
                      </Button>
                    }
                  />
                ) : (
                  <Badge>{roleLabel(m.role)}</Badge>
                )}
                {canRemove ? (
                  <Menu>
                    <MenuTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label={`Actions for ${m.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem
                        danger
                        icon={<UserMinus className="size-3.5" />}
                        onSelect={() => {
                          if (
                            confirm(
                              isMe
                                ? 'Leave this workspace?'
                                : `Remove ${m.name} from the workspace?`,
                            )
                          ) {
                            removeMember.mutate(m.userId, {
                              onError,
                              onSuccess: () => isMe && window.location.assign('/'),
                            });
                          }
                        }}
                      >
                        {isMe ? 'Leave workspace' : 'Remove from workspace'}
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                ) : (
                  <span className="w-7" />
                )}
              </li>
            );
          })}
        </ul>

        {canManageInvites && !!invites.data?.length && (
          <>
            <h2 className="mt-10 text-[13px] font-semibold">Pending invites</h2>
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
              {invites.data.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex size-8 items-center justify-center rounded-full border border-dashed border-border-strong text-fg-subtle">
                    <MailPlus className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{inv.email}</span>
                    <span className="block text-[12px] text-fg-subtle">
                      Expires {formatDate(inv.expiresAt)}
                    </span>
                  </span>
                  <Badge>{roleLabel(inv.role)}</Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Revoke invite for ${inv.email}`}
                    onClick={() => revoke.mutate(inv.id, { onError })}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <InviteDialog open={inviting} onOpenChange={setInviting} myRole={role} />
    </div>
  );
}

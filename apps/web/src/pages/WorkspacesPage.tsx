import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  canInWorkspace,
  createInviteResponse,
  invitableRoles,
  member,
  workspace,
  type MeResponse,
  type Workspace,
} from '@team-os/shared';
import { api, ApiError, setCsrfToken } from '../api';

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong';

export function WorkspacesPage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api('/workspaces', z.array(workspace)),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = workspaces.data?.find((w) => w.id === selectedId) ?? workspaces.data?.[0];

  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api('/workspaces', workspace, { method: 'POST', body: { name } }),
    onSuccess: (ws) => {
      setName('');
      setSelectedId(ws.id);
      return queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });

  async function logout() {
    await api('/auth/logout', null, { method: 'POST' });
    setCsrfToken(null);
    window.location.assign('/login');
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Team OS</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-600">{me.user.email}</span>
          <button onClick={logout} className="text-gray-600 underline">
            Sign out
          </button>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
        <aside className="space-y-4">
          <ul className="space-y-1">
            {workspaces.data?.map((w) => (
              <li key={w.id}>
                <button
                  onClick={() => setSelectedId(w.id)}
                  className={`w-full rounded px-3 py-2 text-left ${w.id === selected?.id ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'}`}
                >
                  {w.name}
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
            className="space-y-2"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="New workspace name"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <button className="w-full rounded bg-gray-900 px-3 py-2 text-sm text-white">
              Create workspace
            </button>
            {create.error && <p className="text-sm text-red-600">{errorText(create.error)}</p>}
          </form>
        </aside>

        {selected ? (
          <WorkspaceDetail key={selected.id} ws={selected} />
        ) : (
          <p className="text-gray-500">Create a workspace to get started.</p>
        )}
      </div>
    </div>
  );
}

function WorkspaceDetail({ ws }: { ws: Workspace }) {
  const canListMembers = canInWorkspace(ws.role, { action: 'member:list' });
  const canInvite = canInWorkspace(ws.role, { action: 'invite:create', role: 'member' });
  const members = useQuery({
    queryKey: ['members', ws.id],
    queryFn: () => api(`/workspaces/${ws.id}/members`, z.array(member)),
    enabled: canListMembers,
  });

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof invitableRoles)[number]>('member');
  const invite = useMutation({
    mutationFn: () =>
      api(`/workspaces/${ws.id}/invites`, createInviteResponse, {
        method: 'POST',
        body: { email, role },
      }),
    onSuccess: () => setEmail(''),
  });

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{ws.name}</h2>
        <p className="text-sm text-gray-500">
          /{ws.slug} · your role: {ws.role}
        </p>
      </div>

      {canListMembers && (
        <div>
          <h3 className="mb-2 font-medium">Members</h3>
          <ul className="divide-y rounded border">
            {members.data?.map((m) => (
              <li key={m.userId} className="flex justify-between px-3 py-2 text-sm">
                <span>
                  {m.name} <span className="text-gray-500">{m.email}</span>
                </span>
                <span className="text-gray-600">{m.role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canInvite && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
          className="space-y-2"
        >
          <h3 className="font-medium">Invite someone</h3>
          <div className="flex gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
              className="rounded border border-gray-300 px-2 text-sm"
            >
              {invitableRoles
                .filter((r) => canInWorkspace(ws.role, { action: 'invite:create', role: r }))
                .map((r) => (
                  <option key={r}>{r}</option>
                ))}
            </select>
            <button className="rounded bg-gray-900 px-4 py-2 text-sm text-white">Invite</button>
          </div>
          {invite.error && <p className="text-sm text-red-600">{errorText(invite.error)}</p>}
          {invite.data && (
            <p className="rounded bg-green-50 p-3 text-sm break-all text-green-800">
              Invite created. Until email is set up, share this link:{' '}
              <a href={invite.data.acceptUrl} className="underline">
                {invite.data.acceptUrl}
              </a>
            </p>
          )}
        </form>
      )}
    </section>
  );
}

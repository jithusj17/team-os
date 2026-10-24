import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { z } from 'zod';
import {
  createInviteResponse,
  invite,
  label,
  member,
  workspace,
  type InvitableRole,
  type WorkspaceRole,
} from '@team-os/shared';
import { api } from '../../lib/api';
import { keys } from '../../lib/keys';

export function useWorkspaces() {
  return useQuery({
    queryKey: keys.workspaces,
    queryFn: () => api('/workspaces', z.array(workspace)),
  });
}

export function useWorkspaceId() {
  const { workspaceId } = useParams();
  if (!workspaceId) throw new Error('useWorkspaceId used outside a workspace route');
  return workspaceId;
}

export function useWorkspace() {
  const id = useWorkspaceId();
  return useQuery({
    queryKey: keys.workspace(id),
    queryFn: () => api(`/workspaces/${id}`, workspace),
  });
}

export function useMembers(enabled = true) {
  const id = useWorkspaceId();
  return useQuery({
    queryKey: keys.members(id),
    queryFn: () => api(`/workspaces/${id}/members`, z.array(member)),
    enabled,
    staleTime: 60_000,
  });
}

export function useInvites(enabled: boolean) {
  const id = useWorkspaceId();
  return useQuery({
    queryKey: keys.invites(id),
    queryFn: () => api(`/workspaces/${id}/invites`, z.array(invite)),
    enabled,
  });
}

export function useLabels() {
  const id = useWorkspaceId();
  return useQuery({
    queryKey: keys.labels(id),
    queryFn: () => api(`/workspaces/${id}/labels`, z.array(label)),
    staleTime: 60_000,
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api('/workspaces', workspace, { method: 'POST', body: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useUpdateWorkspace() {
  const id = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: { name?: string; slug?: string }) =>
      api(`/workspaces/${id}`, workspace, { method: 'PATCH', body: patch }),
    onSuccess: (ws) => {
      queryClient.setQueryData(keys.workspace(id), ws);
      return queryClient.invalidateQueries({ queryKey: keys.workspaces });
    },
  });
}

export function useDeleteWorkspace() {
  const id = useWorkspaceId();
  return useMutation({ mutationFn: () => api(`/workspaces/${id}`, null, { method: 'DELETE' }) });
}

export function useInvite() {
  const id = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; role: InvitableRole }) =>
      api(`/workspaces/${id}/invites`, createInviteResponse, { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invites(id) }),
  });
}

export function useRevokeInvite() {
  const id = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      api(`/workspaces/${id}/invites/${inviteId}`, null, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invites(id) }),
  });
}

export function useChangeRole() {
  const id = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      api(`/workspaces/${id}/members/${userId}`, null, { method: 'PATCH', body: { role } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.members(id) }),
  });
}

export function useRemoveMember() {
  const id = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api(`/workspaces/${id}/members/${userId}`, null, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.members(id) }),
  });
}

/** Map of user id -> member, for rendering names and avatars anywhere in the workspace. */
export function useMemberMap() {
  const { data } = useMembers();
  return new Map((data ?? []).map((m) => [m.userId, m]));
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  project,
  projectDetail,
  projectMember,
  projectStatus,
  type ProjectRole,
  type ProjectVisibility,
  type StatusCategory,
} from '@team-os/shared';
import { api } from '../../lib/api';
import { keys } from '../../lib/keys';
import { useWorkspaceId } from '../workspaces/hooks';

export function useProjects() {
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: keys.projects(workspaceId),
    queryFn: () => api(`/workspaces/${workspaceId}/projects`, z.array(project)),
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: keys.project(projectId),
    queryFn: () => api(`/projects/${projectId}`, projectDetail),
  });
}

/** Everyone who can see the project (for assignee pickers and avatars). */
export function useProjectPeople(projectId: string) {
  return useQuery({
    queryKey: keys.projectMembers(projectId),
    queryFn: () => api(`/projects/${projectId}/people`, z.array(projectMember)),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

export function useCreateProject() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      key: string;
      description?: string;
      visibility: ProjectVisibility;
    }) => api(`/workspaces/${workspaceId}/projects`, projectDetail, { method: 'POST', body }),
    onSuccess: (created) => {
      queryClient.setQueryData(keys.project(created.id), created);
      return queryClient.invalidateQueries({ queryKey: keys.projects(workspaceId) });
    },
  });
}

export function useUpdateProject(projectId: string) {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      patch: Partial<{
        name: string;
        description: string;
        visibility: ProjectVisibility;
        enforceDependencies: boolean;
      }>,
    ) => api(`/projects/${projectId}`, projectDetail, { method: 'PATCH', body: patch }),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.project(projectId), updated);
      return queryClient.invalidateQueries({ queryKey: keys.projects(workspaceId) });
    },
  });
}

export function useDeleteProject(projectId: string) {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/projects/${projectId}`, null, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.projects(workspaceId) }),
  });
}

export function useStatusMutations(projectId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.project(projectId) });
  const base = `/projects/${projectId}/statuses`;
  return {
    create: useMutation({
      mutationFn: (body: { name: string; category: StatusCategory; color: string }) =>
        api(base, projectStatus, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        ...patch
      }: {
        id: string;
        name?: string;
        color?: string;
        category?: StatusCategory;
      }) => api(`${base}/${id}`, projectStatus, { method: 'PATCH', body: patch }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: ({ id, moveTo }: { id: string; moveTo?: string }) =>
        api(`${base}/${id}${moveTo ? `?moveTo=${moveTo}` : ''}`, null, { method: 'DELETE' }),
      onSuccess: async () => {
        await refresh();
        return queryClient.invalidateQueries({ queryKey: keys.tasks(projectId) });
      },
    }),
  };
}

export function useSetProjectMember(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ProjectRole }) =>
      api(`/projects/${projectId}/members/${userId}`, null, { method: 'PUT', body: { role } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.projectMembers(projectId) }),
  });
}

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { doc, docSummary, docVersion, docVersionDetail, type Task } from '@team-os/shared';
import { fetchAllProjectTasks } from '../tasks/hooks';
import { api } from '../../lib/api';
import { keys } from '../../lib/keys';
import { useProjects } from '../projects/hooks';
import { useWorkspaceId } from '../workspaces/hooks';

export function useDocs(projectId?: string) {
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: [...keys.docs(workspaceId), projectId ?? 'all'],
    queryFn: () =>
      api(
        `/workspaces/${workspaceId}/docs${projectId ? `?projectId=${projectId}` : ''}`,
        z.array(docSummary),
      ),
  });
}

export function useDoc(docId: string) {
  return useQuery({ queryKey: keys.doc(docId), queryFn: () => api(`/docs/${docId}`, doc) });
}

export function useCreateDoc() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; body?: string; projectId: string | null }) =>
      api(`/workspaces/${workspaceId}/docs`, doc, { method: 'POST', body }),
    onSuccess: (created) => {
      queryClient.setQueryData(keys.doc(created.id), created);
      return queryClient.invalidateQueries({ queryKey: keys.docs(workspaceId) });
    },
  });
}

export function useDocVersions(docId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.docVersions(docId),
    queryFn: () => api(`/docs/${docId}/versions`, z.array(docVersion)),
    enabled,
  });
}

export const fetchDocVersion = (docId: string, versionId: string) =>
  api(`/docs/${docId}/versions/${versionId}`, docVersionDetail);

export function useDocMutations(docId: string) {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const settle = (d: z.infer<typeof doc>) => {
    queryClient.setQueryData(keys.doc(docId), d);
    void queryClient.invalidateQueries({ queryKey: keys.docs(workspaceId) });
  };
  return {
    save: (body: { version: number; title?: string; body?: string }) =>
      api(`/docs/${docId}`, doc, { method: 'PATCH', body }),
    settle,
    link: useMutation({
      mutationFn: ({ taskId, link }: { taskId: string; link: boolean }) =>
        link
          ? api(`/docs/${docId}/tasks`, doc, { method: 'POST', body: { taskId } })
          : api(`/docs/${docId}/tasks/${taskId}`, doc, { method: 'DELETE' }),
      onSuccess: settle,
    }),
    remove: useMutation({
      mutationFn: () => api(`/docs/${docId}`, null, { method: 'DELETE' }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.docs(workspaceId) }),
    }),
  };
}

/**
 * Tasks from every project the user can see, for "link a task" pickers. Reuses the per-project
 * task caches the board uses, so it's free when those are already loaded.
 */
export function useAllVisibleTasks(enabled: boolean): Task[] {
  const projects = useProjects();
  const results = useQueries({
    queries: (enabled ? (projects.data ?? []) : []).map((p) => ({
      queryKey: keys.tasks(p.id),
      queryFn: () => fetchAllProjectTasks(p.id),
      staleTime: 60_000,
    })),
  });
  return results.flatMap((r) => r.data ?? []);
}

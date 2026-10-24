import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  activityEntry,
  comment,
  task,
  taskDependencies,
  taskList,
  type Task,
  type UpdateTaskBody,
} from '@team-os/shared';
import { api, ApiError, errorMessage } from '../../lib/api';
import { keys } from '../../lib/keys';

/** Loads every task in a project (following pagination). Real-time events keep it current. */
/** Fetches every task in a project, following pagination. */
export async function fetchAllProjectTasks(projectId: string): Promise<Task[]> {
  const all: Task[] = [];
  let cursor: string | null = null;
  do {
    const page: z.infer<typeof taskList> = await api(
      `/projects/${projectId}/tasks?limit=100&sort=position${cursor ? `&cursor=${cursor}` : ''}`,
      taskList,
    );
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

export function useProjectTasks(projectId: string) {
  return useQuery({
    queryKey: keys.tasks(projectId),
    queryFn: () => fetchAllProjectTasks(projectId),
  });
}

/** Inserts or replaces a task everywhere it is cached. */
export function upsertTaskInCache(queryClient: QueryClient, t: Task) {
  queryClient.setQueryData<Task>(keys.task(t.id), (old) =>
    old && old.version > t.version ? old : t,
  );
  queryClient.setQueryData<Task[]>(keys.tasks(t.projectId), (old) => {
    if (!old) return old;
    const i = old.findIndex((x) => x.id === t.id);
    if (i === -1) return [...old, t];
    // Never let a late, older copy overwrite a newer one.
    if (old[i]!.version > t.version) return old;
    const next = old.slice();
    next[i] = t;
    return next;
  });
}

export function removeTaskFromCache(queryClient: QueryClient, projectId: string, taskId: string) {
  queryClient.setQueryData<Task[]>(keys.tasks(projectId), (old) =>
    old?.filter((t) => t.id !== taskId),
  );
  queryClient.removeQueries({ queryKey: keys.task(taskId) });
}

export function useTask(taskId: string | null, projectId?: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: keys.task(taskId ?? 'none'),
    queryFn: () => api(`/tasks/${taskId}`, task),
    enabled: !!taskId,
    // Show the copy from the project list instantly while the fresh one loads.
    initialData: () =>
      projectId && taskId
        ? queryClient.getQueryData<Task[]>(keys.tasks(projectId))?.find((t) => t.id === taskId)
        : undefined,
  });
}

export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/projects/${projectId}/tasks`, task, { method: 'POST', body }),
    onSuccess: (created) => upsertTaskInCache(queryClient, created),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** The newest version of a task we know about, from either cache. */
function latestVersion(queryClient: QueryClient, t: Pick<Task, 'id' | 'projectId' | 'version'>) {
  const single = queryClient.getQueryData<Task>(keys.task(t.id))?.version ?? 0;
  const listed =
    queryClient.getQueryData<Task[]>(keys.tasks(t.projectId))?.find((x) => x.id === t.id)
      ?.version ?? 0;
  return Math.max(single, listed, t.version);
}

export interface TaskUpdate {
  id: string;
  projectId: string;
  version: number;
  changes: Omit<UpdateTaskBody, 'version'>;
  /** Extra fields to show immediately (e.g. a computed sortOrder for drag and drop). */
  optimistic?: Partial<Task>;
}

/**
 * Updates a task optimistically: the change shows immediately and is rolled back if the server
 * rejects it. Updates run one at a time and each sends the newest known version, so quick
 * successive edits don't conflict with each other; a real conflict (someone else edited
 * first) reloads the task.
 */
export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: 'task-updates' },
    mutationFn: ({ id, projectId, version, changes }: TaskUpdate) =>
      api(`/tasks/${id}`, task, {
        method: 'PATCH',
        body: { ...changes, version: latestVersion(queryClient, { id, projectId, version }) },
      }),
    onMutate: async ({ id, changes, projectId, optimistic }) => {
      await queryClient.cancelQueries({ queryKey: keys.tasks(projectId) });
      const previous = queryClient.getQueryData<Task[]>(keys.tasks(projectId));
      const previousTask = queryClient.getQueryData<Task>(keys.task(id));
      const { position: _p, labelIds: _l, ...fields } = changes;
      const apply = (t: Task): Task => ({ ...t, ...fields, ...optimistic }) as Task;
      queryClient.setQueryData<Task[]>(keys.tasks(projectId), (old) =>
        old?.map((t) => (t.id === id ? apply(t) : t)),
      );
      if (previousTask) queryClient.setQueryData(keys.task(id), apply(previousTask));
      return { previous, previousTask };
    },
    onError: (err, { id, projectId }, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(keys.tasks(projectId), ctx.previous);
      if (ctx?.previousTask) queryClient.setQueryData(keys.task(id), ctx.previousTask);
      if (err instanceof ApiError && err.code === 'version_conflict') {
        toast.warning('Someone else just changed this task. Showing the latest version.');
        void queryClient.invalidateQueries({ queryKey: keys.task(id) });
        void queryClient.invalidateQueries({ queryKey: keys.tasks(projectId) });
      } else {
        toast.error(errorMessage(err));
      }
    },
    onSuccess: (updated) => upsertTaskInCache(queryClient, updated),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (t: Task) => api(`/tasks/${t.id}`, null, { method: 'DELETE' }),
    onSuccess: (_, t) => removeTaskFromCache(queryClient, t.projectId, t.id),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useComments(taskId: string) {
  return useQuery({
    queryKey: keys.comments(taskId),
    queryFn: () => api(`/tasks/${taskId}/comments`, z.array(comment)),
  });
}

export function useActivity(taskId: string) {
  return useQuery({
    queryKey: keys.activity(taskId),
    queryFn: () => api(`/tasks/${taskId}/activity`, z.array(activityEntry)),
  });
}

export function useCommentMutations(taskId: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.comments(taskId) }),
      queryClient.invalidateQueries({ queryKey: keys.activity(taskId) }),
    ]);
  const onError = (err: unknown) => toast.error(errorMessage(err));
  return {
    add: useMutation({
      mutationFn: (body: string) =>
        api(`/tasks/${taskId}/comments`, comment, { method: 'POST', body: { body } }),
      onSuccess: refresh,
      onError,
    }),
    edit: useMutation({
      mutationFn: ({ id, body }: { id: string; body: string }) =>
        api(`/comments/${id}`, comment, { method: 'PATCH', body: { body } }),
      onSuccess: refresh,
      onError,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/comments/${id}`, null, { method: 'DELETE' }),
      onSuccess: refresh,
      onError,
    }),
  };
}

export function useDependencies(taskId: string) {
  return useQuery({
    queryKey: keys.dependencies(taskId),
    queryFn: () => api(`/tasks/${taskId}/dependencies`, taskDependencies),
  });
}

export function useDependencyMutations(taskId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.dependencies(taskId) });
  const onError = (err: unknown) => toast.error(errorMessage(err));
  return {
    add: useMutation({
      mutationFn: (blockerId: string) =>
        api(`/tasks/${taskId}/dependencies`, taskDependencies, {
          method: 'POST',
          body: { blockerId },
        }),
      onSuccess: (deps) => queryClient.setQueryData(keys.dependencies(taskId), deps),
      onError,
    }),
    remove: useMutation({
      mutationFn: (blockerId: string) =>
        api(`/tasks/${taskId}/dependencies/${blockerId}`, null, { method: 'DELETE' }),
      onSuccess: refresh,
      onError,
    }),
  };
}

export function useWatching(taskId: string, userId: string) {
  const queryClient = useQueryClient();
  const watchers = useQuery({
    queryKey: keys.watchers(taskId),
    queryFn: () => api(`/tasks/${taskId}/watchers`, z.array(z.string())),
  });
  const toggle = useMutation({
    mutationFn: (watch: boolean) =>
      api(`/tasks/${taskId}/watchers/me`, null, { method: watch ? 'PUT' : 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.watchers(taskId) }),
  });
  return { watching: watchers.data?.includes(userId) ?? false, toggle };
}

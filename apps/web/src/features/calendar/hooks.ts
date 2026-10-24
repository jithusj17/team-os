import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { meeting, type Meeting, type RsvpResponse } from '@team-os/shared';
import { api, errorMessage } from '../../lib/api';
import { keys } from '../../lib/keys';
import { useWorkspaceId } from '../workspaces/hooks';

export function useMeetings(from: Date, to: Date, mine: boolean) {
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: [...keys.meetings(workspaceId), from.toISOString(), mine],
    queryFn: () =>
      api(
        `/workspaces/${workspaceId}/meetings?from=${from.toISOString()}&to=${to.toISOString()}${mine ? '&mine=true' : ''}`,
        z.array(meeting),
      ),
    placeholderData: (previous) => previous,
  });
}

export function useMeeting(id: string | null) {
  return useQuery({
    queryKey: keys.meeting(id ?? 'none'),
    queryFn: () => api(`/meetings/${id}`, meeting),
    enabled: !!id,
  });
}

export interface MeetingInput {
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  attendeeIds: string[];
  projectId?: string | null;
}

export function useMeetingMutations() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const refresh = (m?: Meeting) => {
    if (m) queryClient.setQueryData(keys.meeting(m.id), m);
    return queryClient.invalidateQueries({ queryKey: keys.meetings(workspaceId) });
  };
  const onError = (err: unknown) => toast.error(errorMessage(err));
  return {
    create: useMutation({
      mutationFn: (body: MeetingInput) =>
        api(`/workspaces/${workspaceId}/meetings`, meeting, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Partial<MeetingInput> & { id: string; version: number }) =>
        api(`/meetings/${id}`, meeting, { method: 'PATCH', body }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/meetings/${id}`, null, { method: 'DELETE' }),
      onSuccess: () => refresh(),
      onError,
    }),
    rsvp: useMutation({
      mutationFn: ({ id, response }: { id: string; response: Exclude<RsvpResponse, 'pending'> }) =>
        api(`/meetings/${id}/rsvp`, meeting, { method: 'PUT', body: { response } }),
      onSuccess: refresh,
      onError,
    }),
    link: useMutation({
      mutationFn: ({ id, taskId, link }: { id: string; taskId: string; link: boolean }) =>
        link
          ? api(`/meetings/${id}/tasks`, meeting, { method: 'POST', body: { taskId } })
          : api(`/meetings/${id}/tasks/${taskId}`, meeting, { method: 'DELETE' }),
      onSuccess: refresh,
      onError,
    }),
    notes: useMutation({
      mutationFn: (id: string) =>
        api(`/meetings/${id}/notes`, z.object({ docId: z.string() }), { method: 'POST' }),
      onError,
    }),
  };
}

// ---- Week math (local time) ----

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}

export const addDays = (date: Date, n: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/**
 * Side-by-side lanes for overlapping meetings within a day, so they don't hide each other.
 * Returns each meeting's lane index and the lane count of its overlap group.
 */
export function layoutDay(items: Meeting[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const result = new Map<string, { lane: number; lanes: number }>();
  let group: Meeting[] = [];
  let groupEnd = 0;
  const laneEnds: number[] = [];

  const closeGroup = () => {
    for (const m of group) result.get(m.id)!.lanes = laneEnds.length;
    group = [];
    laneEnds.length = 0;
  };

  for (const m of sorted) {
    if (group.length && m.startsAt.getTime() >= groupEnd) closeGroup();
    let lane = laneEnds.findIndex((end) => end <= m.startsAt.getTime());
    if (lane === -1) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = m.endsAt.getTime();
    result.set(m.id, { lane, lanes: 1 });
    group.push(m);
    groupEnd = Math.max(groupEnd, m.endsAt.getTime());
  }
  closeGroup();
  return result;
}

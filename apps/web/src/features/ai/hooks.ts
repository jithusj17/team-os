import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  aiProposal,
  aiStatus,
  aiStreamEvent,
  type AiStreamEvent,
  type SummaryType,
} from '@team-os/shared';
import { api, apiStream, errorMessage } from '../../lib/api';
import { useWorkspaceId } from '../workspaces/hooks';

/** Whether the server has AI configured (AI controls are hidden otherwise). */
export function useAiEnabled() {
  const status = useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => api('/ai/status', aiStatus),
    staleTime: Infinity,
  });
  return status.data?.enabled ?? false;
}

export type AiSource = Extract<AiStreamEvent, { type: 'sources' }>['sources'][number];

interface StreamState {
  status: 'idle' | 'streaming' | 'done' | 'error';
  text: string;
  sources: AiSource[];
  cached: boolean;
  error: string | null;
}

const idle: StreamState = { status: 'idle', text: '', sources: [], cached: false, error: null };

/** Runs a streaming AI request, accumulating text as it arrives. Cancels on unmount. */
export function useAiStream() {
  const [state, setState] = useState<StreamState>(idle);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const start = useCallback(
    async (path: string, body: unknown) => {
      cancel();
      const abort = new AbortController();
      abortRef.current = abort;
      setState({ ...idle, status: 'streaming' });
      try {
        for await (const event of apiStream(path, aiStreamEvent, body, abort.signal)) {
          setState((s) => {
            switch (event.type) {
              case 'sources':
                return { ...s, sources: event.sources };
              case 'delta':
                return { ...s, text: s.text + event.text };
              case 'done':
                return { ...s, status: 'done', cached: event.cached };
              case 'error':
                return { ...s, status: 'error', error: event.message };
            }
          });
        }
        // A stream that ends without "done" was cut off.
        setState((s) =>
          s.status === 'streaming'
            ? { ...s, status: 'error', error: 'The response was interrupted.' }
            : s,
        );
      } catch (err) {
        if (abort.signal.aborted) return;
        setState((s) => ({ ...s, status: 'error', error: errorMessage(err) }));
      }
    },
    [cancel],
  );

  const reset = useCallback(() => {
    cancel();
    setState(idle);
  }, [cancel]);

  return { ...state, start, reset };
}

export function useSummary(type: SummaryType, id: string) {
  const stream = useAiStream();
  return { ...stream, run: () => stream.start('/ai/summaries', { type, id }) };
}

export type ProposalSource = { type: 'meeting' | 'doc' | 'task'; id: string };

export function useProposeActions() {
  const workspaceId = useWorkspaceId();
  return useMutation({
    mutationFn: (body: {
      instruction: string;
      projectId: string | null;
      source: ProposalSource | null;
    }) => api(`/workspaces/${workspaceId}/ai/proposals`, aiProposal, { method: 'POST', body }),
  });
}

export function useExecuteProposal() {
  return useMutation({
    mutationFn: ({ id, actionIds }: { id: string; actionIds: number[] }) =>
      api(`/ai/proposals/${id}/execute`, aiProposal, { method: 'POST', body: { actionIds } }),
  });
}

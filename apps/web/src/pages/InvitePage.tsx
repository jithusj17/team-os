import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { invitePreview } from '@team-os/shared';
import { api, ApiError } from '../api';
import { navigate } from '../router';

export function InvitePage({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api(`/invites/${token}`, invitePreview),
  });
  const accept = useMutation({
    mutationFn: () =>
      api(`/invites/${token}/accept`, z.object({ workspaceId: z.string() }), { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      navigate('/');
    },
  });

  return (
    <main className="mx-auto mt-24 max-w-md space-y-4 p-8">
      {preview.isPending && <p>Loading invite…</p>}
      {preview.isError && <p className="text-red-600">This invite link is not valid.</p>}
      {preview.data && (
        <>
          <h1 className="text-xl font-semibold">Join {preview.data.workspaceName}</h1>
          <p className="text-gray-600">
            {preview.data.invitedByName ?? 'Someone'} invited {preview.data.email} as{' '}
            {preview.data.role}.
          </p>
          {preview.data.status === 'pending' ? (
            <button
              onClick={() => accept.mutate()}
              disabled={accept.isPending}
              className="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
            >
              Accept invite
            </button>
          ) : (
            <p className="text-amber-700">This invite is {preview.data.status}.</p>
          )}
          {accept.error && (
            <p className="text-sm text-red-600">
              {accept.error instanceof ApiError ? accept.error.message : 'Could not accept invite'}
            </p>
          )}
        </>
      )}
    </main>
  );
}

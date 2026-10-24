import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { invitePreview } from '@team-os/shared';
import { Logo } from '../../components/icons';
import { Button } from '../../components/ui/button';
import { PageSpinner } from '../../components/ui/spinner';
import { api, errorMessage } from '../../lib/api';
import { keys } from '../../lib/keys';
import { useCurrentUser, useSignOut } from '../auth/hooks';

export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const me = useCurrentUser();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api(`/invites/${token}`, invitePreview),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () =>
      api(`/invites/${token}/accept`, z.object({ workspaceId: z.string() }), { method: 'POST' }),
    onSuccess: async ({ workspaceId }) => {
      await queryClient.invalidateQueries({ queryKey: keys.workspaces });
      navigate(`/w/${workspaceId}`);
    },
  });

  if (preview.isPending) return <PageSpinner />;

  const data = preview.data;
  const wrongAccount = data && data.email.toLowerCase() !== me.email.toLowerCase();

  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-pop">
        <Logo className="size-8" />
        {!data ? (
          <>
            <h1 className="mt-5 text-lg font-semibold">This invite link isn’t valid</h1>
            <p className="mt-1 text-[13px] text-fg-muted">
              Ask the person who invited you for a new link.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-lg font-semibold">Join {data.workspaceName}</h1>
            <p className="mt-1 text-[13px] text-fg-muted">
              {data.invitedByName ?? 'Someone'} invited{' '}
              <span className="font-medium text-fg">{data.email}</span> to join as{' '}
              {data.role === 'admin' ? 'an admin' : `a ${data.role}`}.
            </p>
            {data.status !== 'pending' ? (
              <p className="mt-5 rounded-lg bg-muted px-3 py-2 text-[13px] text-fg-muted">
                This invite has been {data.status}.
              </p>
            ) : wrongAccount ? (
              <div className="mt-5 space-y-3">
                <p className="rounded-lg bg-muted px-3 py-2 text-[13px] text-fg-muted">
                  You’re signed in as {me.email}. Sign in as {data.email} to accept.
                </p>
                <Button className="w-full justify-center" onClick={signOut}>
                  Switch account
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="mt-6 w-full justify-center"
                loading={accept.isPending}
                onClick={() => accept.mutate()}
              >
                <MailCheck className="size-4" /> Accept invite
              </Button>
            )}
            {accept.error && (
              <p className="mt-3 text-[13px] text-danger">{errorMessage(accept.error)}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

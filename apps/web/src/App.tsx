import { useQuery } from '@tanstack/react-query';
import { meResponse } from '@team-os/shared';
import { api, ApiError, setCsrfToken } from './api';
import { usePath } from './router';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { WorkspacesPage } from './pages/WorkspacesPage';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await api('/auth/me', meResponse);
        setCsrfToken(me.csrfToken);
        return me;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

export function App() {
  const path = usePath();
  const me = useMe();

  if (path === '/login') return <LoginPage />;
  if (me.isPending) return <p className="p-8 text-gray-500">Loading…</p>;
  if (me.isError) return <p className="p-8 text-red-600">Could not reach the server.</p>;
  if (!me.data) {
    window.location.replace(`/login?returnTo=${encodeURIComponent(path)}`);
    return null;
  }

  const invite = path.match(/^\/invites\/([^/]+)$/);
  if (invite) return <InvitePage token={invite[1]!} />;
  return <WorkspacesPage me={me.data} />;
}

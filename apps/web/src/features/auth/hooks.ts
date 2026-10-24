import { useQuery, useQueryClient } from '@tanstack/react-query';
import { meResponse, type MeResponse } from '@team-os/shared';
import { api, ApiError, setCsrfToken } from '../../lib/api';
import { keys } from '../../lib/keys';

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async (): Promise<MeResponse | null> => {
      try {
        const me = await api('/auth/me', meResponse);
        setCsrfToken(me.csrfToken);
        return me;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
  });
}

/** The signed-in user. Only call below <RequireAuth>, where it is guaranteed to exist. */
export function useCurrentUser() {
  const { data } = useMe();
  if (!data) throw new Error('useCurrentUser used outside RequireAuth');
  return data.user;
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return async () => {
    await api('/auth/logout', null, { method: 'POST' }).catch(() => {});
    setCsrfToken(null);
    queryClient.clear();
    window.location.assign('/login');
  };
}

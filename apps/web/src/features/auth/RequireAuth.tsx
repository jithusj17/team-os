import { Navigate, Outlet, useLocation } from 'react-router';
import { Button } from '../../components/ui/button';
import { PageSpinner } from '../../components/ui/spinner';
import { useMe } from './hooks';

/** Renders child routes only for signed-in users; sends others to /login and back afterwards. */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <PageSpinner />;
  if (me.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[14px] text-fg-muted">
        Could not reach the server.
        <Button onClick={() => me.refetch()}>Try again</Button>
      </div>
    );
  }
  if (!me.data) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }
  return <Outlet />;
}

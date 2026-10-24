import { createBrowserRouter, Link, useRouteError } from 'react-router';
import { Button } from './components/ui/button';
import { EmptyState } from './components/ui/misc';
import { LoginPage } from './features/auth/LoginPage';
import { RequireAuth } from './features/auth/RequireAuth';
import { CalendarPage } from './features/calendar/CalendarPage';
import { DocPage } from './features/docs/DocPage';
import { DocsPage } from './features/docs/DocsPage';
import { InboxPage } from './features/notifications/InboxPage';
import { ProjectPage } from './features/projects/ProjectPage';
import { AcceptInvitePage } from './features/workspaces/AcceptInvitePage';
import { MembersPage } from './features/workspaces/MembersPage';
import {
  CreateWorkspacePage,
  HomeRedirect,
  TaskKeyRedirect,
  WorkspaceHome,
  WorkspaceLayout,
} from './features/workspaces/pages';
import { SettingsPage } from './features/workspaces/SettingsPage';

function NotFound() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<span className="text-sm font-semibold">404</span>}
        title="Page not found"
        action={
          <Link to="/">
            <Button>Go home</Button>
          </Link>
        }
      />
    </div>
  );
}

function RouteError() {
  const error = useRouteError();
  console.error(error);
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<span className="text-sm font-semibold">!</span>}
        title="Something went wrong"
        description="An unexpected error occurred. Reloading usually helps."
        action={<Button onClick={() => window.location.reload()}>Reload</Button>}
      />
    </div>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <HomeRedirect /> },
      { path: '/new', element: <CreateWorkspacePage /> },
      { path: '/invites/:token', element: <AcceptInvitePage /> },
      {
        path: '/w/:workspaceId',
        element: <WorkspaceLayout />,
        children: [
          { index: true, element: <WorkspaceHome /> },
          { path: 'p/:projectId', element: <ProjectPage /> },
          { path: 'tasks/:taskKey', element: <TaskKeyRedirect /> },
          { path: 'inbox', element: <InboxPage /> },
          { path: 'docs', element: <DocsPage /> },
          { path: 'docs/:docId', element: <DocPage /> },
          { path: 'calendar', element: <CalendarPage /> },
          { path: 'members', element: <MembersPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

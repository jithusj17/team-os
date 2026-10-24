/** TanStack Query keys, in one place so real-time updates and mutations agree on them. */
export const keys = {
  me: ['me'] as const,
  providers: ['providers'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspace', id] as const,
  members: (workspaceId: string) => ['members', workspaceId] as const,
  invites: (workspaceId: string) => ['invites', workspaceId] as const,
  labels: (workspaceId: string) => ['labels', workspaceId] as const,
  projects: (workspaceId: string) => ['projects', workspaceId] as const,
  project: (id: string) => ['project', id] as const,
  projectMembers: (id: string) => ['project-members', id] as const,
  /** Every task in a project, kept current by real-time events. */
  tasks: (projectId: string) => ['tasks', projectId] as const,
  task: (id: string) => ['task', id] as const,
  comments: (taskId: string) => ['comments', taskId] as const,
  activity: (taskId: string) => ['activity', taskId] as const,
  dependencies: (taskId: string) => ['dependencies', taskId] as const,
  watchers: (taskId: string) => ['watchers', taskId] as const,
  notifications: ['notifications'] as const,
  notificationPrefs: ['notification-prefs'] as const,
};

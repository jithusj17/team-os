import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { DbExecutor } from './infrastructure/db/executor.js';
import { DrizzleUnitOfWork } from './infrastructure/db/drizzle-unit-of-work.js';
import { BullMqJobQueue } from './infrastructure/queues/bullmq-job-queue.js';
import type { RedisClient } from './infrastructure/redis.js';
import {
  CompleteOAuthSignIn,
  OAuthProviderRegistry,
  StartOAuthSignIn,
} from './modules/identity/application/oauth-sign-in.js';
import {
  DevSignIn,
  GetCurrentUser,
  SignOut,
} from './modules/identity/application/session-use-cases.js';
import type { OAuthProvider } from './modules/identity/domain/ports.js';
import { providersFromConfig } from './modules/identity/infrastructure/oauth-providers.js';
import { RedisOAuthStateStore } from './modules/identity/infrastructure/redis-oauth-state-store.js';
import { RedisSessionStore } from './modules/identity/infrastructure/redis-session-store.js';
import {
  AcceptInvite,
  CreateInvite,
  ListInvites,
  PreviewInvite,
  RevokeInvite,
} from './modules/workspaces/application/invite-use-cases.js';
import {
  ChangeMemberRole,
  ListMembers,
  RemoveMember,
} from './modules/workspaces/application/member-use-cases.js';
import { WorkspaceAccess } from './modules/workspaces/application/workspace-access.js';
import {
  CreateWorkspace,
  DeleteWorkspace,
  GetWorkspace,
  ListMyWorkspaces,
  UpdateWorkspace,
} from './modules/workspaces/application/workspace-use-cases.js';
import { ProjectAccess } from './modules/projects/application/project-access.js';
import {
  CreateProject,
  DeleteProject,
  GetProject,
  ListProjectMembers,
  ListProjectPeople,
  ListProjects,
  RemoveProjectMember,
  SetProjectMember,
  UpdateProject,
} from './modules/projects/application/project-use-cases.js';
import {
  CreateStatus,
  DeleteStatus,
  ReorderStatuses,
  UpdateStatus,
} from './modules/projects/application/status-use-cases.js';
import {
  AddComment,
  DeleteComment,
  EditComment,
  ListComments,
} from './modules/tasks/application/comment-use-cases.js';
import {
  AddDependency,
  GetDependencyGraph,
  ListDependencies,
  RemoveDependency,
} from './modules/tasks/application/dependency-use-cases.js';
import {
  CreateLabel,
  DeleteLabel,
  ListLabels,
  UpdateLabel,
} from './modules/tasks/application/label-use-cases.js';
import {
  CreateTask,
  DeleteTask,
  GetTask,
  GetTaskByKey,
  ListTaskActivity,
  ListTasks,
  TaskAccess,
  UpdateTask,
} from './modules/tasks/application/task-use-cases.js';
import {
  ListEventsSince,
  Presence,
  RealtimeAccess,
} from './modules/realtime/application/realtime-use-cases.js';
import { RedisPresenceStore } from './modules/realtime/infrastructure/redis-presence-store.js';
import {
  FanOutEvent,
  GetNotificationPreferences,
  ListNotifications,
  MarkNotificationsRead,
  SendDueSoonReminders,
  SendEmailDigests,
  UpdateNotificationPreferences,
} from './modules/notifications/application/notification-use-cases.js';
import { SocketIoNotificationPusher } from './modules/notifications/infrastructure/socket-io-notification-pusher.js';
import { ListWatchers, SetWatching } from './modules/tasks/application/watcher-use-cases.js';
import {
  CreateDoc,
  DeleteDoc,
  DocAccess,
  GetDoc,
  GetDocVersion,
  LinkDocTask,
  ListDocVersions,
  ListDocs,
  UpdateDoc,
} from './modules/docs/application/doc-use-cases.js';
import {
  CreateMeeting,
  DeleteMeeting,
  GetMeeting,
  LinkMeetingTask,
  ListMeetings,
  OpenMeetingNotes,
  RespondToMeeting,
  UpdateMeeting,
} from './modules/meetings/application/meeting-use-cases.js';
import type { AppUrls } from './shared/application/ports.js';
import { CryptoTokenService, systemClock } from './shared/infrastructure/crypto-token-service.js';

/**
 * Composition root: the only place that knows which implementation backs each port.
 * Everything else depends on interfaces.
 */
export function createContainer(deps: {
  config: Config;
  db: DbExecutor;
  redis: RedisClient;
  log: Pick<Logger, 'error'>;
  oauthProviders?: OAuthProvider[];
}) {
  const { config, db, redis, log } = deps;

  const uow = new DrizzleUnitOfWork(db);
  const tokens = new CryptoTokenService();
  const clock = systemClock;
  const jobs = new BullMqJobQueue(config.REDIS_URL, log);
  const urls: AppUrls = {
    invite: (token) => `${config.WEB_ORIGIN}/invites/${token}`,
    task: (workspaceId, key) => `${config.WEB_ORIGIN}/w/${workspaceId}/tasks/${key}`,
  };
  const sessions = new RedisSessionStore(redis, tokens, {
    idleTtlDays: config.SESSION_TTL_DAYS,
    maxAgeDays: config.SESSION_MAX_AGE_DAYS,
  });
  const providers = new OAuthProviderRegistry(deps.oauthProviders ?? providersFromConfig(config));
  const stateStore = new RedisOAuthStateStore(redis);
  const access = new WorkspaceAccess(uow.repos.members);
  const projectAccess = new ProjectAccess(uow.repos.projects);
  const taskAccess = new TaskAccess({ tasks: uow.repos.tasks, projectAccess });
  const projectDeps = { uow, projectAccess };
  const taskDeps = { uow, projectAccess, taskAccess, clock };
  const pusher = new SocketIoNotificationPusher(redis);
  const docAccess = new DocAccess({
    docs: uow.repos.docs,
    members: uow.repos.members,
    projectAccess,
  });
  const docDeps = { uow, docAccess, projectAccess, clock, workspaceAccess: access };
  const meetingDeps = { uow, projectAccess, workspaceAccess: access };
  const deliveryDeps = { uow, projectAccess, pusher, clock };
  const realtimeAccess = new RealtimeAccess({
    workspaceAccess: access,
    projectAccess,
    taskAccess,
    uow,
  });

  return {
    uow,
    tokens,
    sessions,
    jobs,
    access,
    identity: {
      providers,
      startOAuthSignIn: new StartOAuthSignIn({ providers, stateStore, tokens }),
      completeOAuthSignIn: new CompleteOAuthSignIn({ providers, stateStore, sessions, uow }),
      devSignIn: new DevSignIn({ uow, sessions }),
      getCurrentUser: new GetCurrentUser({ uow, sessions }),
      signOut: new SignOut({ sessions }),
    },
    workspaces: {
      list: new ListMyWorkspaces({ uow }),
      create: new CreateWorkspace({ uow, tokens }),
      get: new GetWorkspace({ uow, access }),
      update: new UpdateWorkspace({ uow, access }),
      delete: new DeleteWorkspace({ uow, access }),
      listMembers: new ListMembers({ uow, access }),
      changeMemberRole: new ChangeMemberRole({ uow, access }),
      removeMember: new RemoveMember({ uow, access }),
      createInvite: new CreateInvite({ uow, access, tokens, clock, jobs, urls }),
      listInvites: new ListInvites({ uow, access, clock }),
      revokeInvite: new RevokeInvite({ uow, access, clock }),
      previewInvite: new PreviewInvite({ uow, tokens, clock }),
      acceptInvite: new AcceptInvite({ uow, tokens, clock }),
    },
    projects: {
      list: new ListProjects({ ...projectDeps, workspaceAccess: access }),
      create: new CreateProject({ ...projectDeps, workspaceAccess: access }),
      get: new GetProject(projectDeps),
      update: new UpdateProject(projectDeps),
      delete: new DeleteProject(projectDeps),
      listMembers: new ListProjectMembers(projectDeps),
      listPeople: new ListProjectPeople(projectDeps),
      setMember: new SetProjectMember(projectDeps),
      removeMember: new RemoveProjectMember(projectDeps),
      createStatus: new CreateStatus(projectDeps),
      updateStatus: new UpdateStatus(projectDeps),
      reorderStatuses: new ReorderStatuses(projectDeps),
      deleteStatus: new DeleteStatus(projectDeps),
    },
    tasks: {
      list: new ListTasks(taskDeps),
      get: new GetTask(taskDeps),
      getByKey: new GetTaskByKey(taskDeps),
      create: new CreateTask(taskDeps),
      update: new UpdateTask(taskDeps),
      delete: new DeleteTask(taskDeps),
      activity: new ListTaskActivity(taskDeps),
      listComments: new ListComments(taskDeps),
      addComment: new AddComment(taskDeps),
      editComment: new EditComment(taskDeps),
      deleteComment: new DeleteComment(taskDeps),
      listDependencies: new ListDependencies(taskDeps),
      addDependency: new AddDependency(taskDeps),
      removeDependency: new RemoveDependency(taskDeps),
      dependencyGraph: new GetDependencyGraph(taskDeps),
      listWatchers: new ListWatchers(taskDeps),
      setWatching: new SetWatching(taskDeps),
    },
    notifications: {
      fanOut: new FanOutEvent(deliveryDeps),
      sendDueSoonReminders: new SendDueSoonReminders(deliveryDeps),
      sendEmailDigests: new SendEmailDigests({ uow, jobs, urls, clock }),
      list: new ListNotifications({ uow, clock }),
      markRead: new MarkNotificationsRead({ uow, clock }),
      getPreferences: new GetNotificationPreferences({ uow, clock }),
      updatePreferences: new UpdateNotificationPreferences({ uow, clock }),
    },
    docs: {
      list: new ListDocs(docDeps),
      create: new CreateDoc(docDeps),
      get: new GetDoc(docDeps),
      update: new UpdateDoc(docDeps),
      delete: new DeleteDoc(docDeps),
      versions: new ListDocVersions(docDeps),
      version: new GetDocVersion(docDeps),
      linkTask: new LinkDocTask(docDeps),
    },
    meetings: {
      list: new ListMeetings(meetingDeps),
      create: new CreateMeeting(meetingDeps),
      get: new GetMeeting(meetingDeps),
      update: new UpdateMeeting(meetingDeps),
      delete: new DeleteMeeting(meetingDeps),
      respond: new RespondToMeeting(meetingDeps),
      linkTask: new LinkMeetingTask(meetingDeps),
      openNotes: new OpenMeetingNotes(meetingDeps),
    },
    realtime: {
      access: realtimeAccess,
      listEvents: new ListEventsSince({ uow, workspaceAccess: access }),
      presence: new Presence({ access: realtimeAccess, store: new RedisPresenceStore(redis) }),
    },
    labels: {
      list: new ListLabels({ uow, workspaceAccess: access }),
      create: new CreateLabel({ uow, workspaceAccess: access }),
      update: new UpdateLabel({ uow, workspaceAccess: access }),
      delete: new DeleteLabel({ uow, workspaceAccess: access }),
    },
    async close() {
      await jobs.close();
    },
  };
}

export type Container = ReturnType<typeof createContainer>;

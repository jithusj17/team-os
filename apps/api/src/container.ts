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
  const urls: AppUrls = { invite: (token) => `${config.WEB_ORIGIN}/invites/${token}` };
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

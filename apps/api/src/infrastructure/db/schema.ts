import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  projectRoles,
  projectVisibilities,
  statusCategories,
  workspaceRoles,
} from '@team-os/shared';

// Postgres extensions (vector, citext) are enabled by migration 0000.
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const oauthProvider = pgEnum('oauth_provider', ['google', 'github']);
export const workspaceRole = pgEnum('workspace_role', workspaceRoles);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    provider: oauthProvider('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerUserId] }), index().on(t.userId)],
);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: citext('slug').notNull().unique(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  /** Last event sequence number issued; see `events`. */
  eventSeq: bigint('event_seq', { mode: 'number' }).notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index().on(t.userId)],
);

export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    role: workspaceRole('role').notNull(),
    /** SHA-256 of the invite token; the raw token only ever exists in the invite link. */
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.workspaceId),
    // At most one open invite per email per workspace.
    uniqueIndex('workspace_invites_open_email_idx')
      .on(t.workspaceId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    check('workspace_invites_role_not_owner', sql`${t.role} <> 'owner'`),
  ],
);

// ---- Projects ----

export const projectVisibility = pgEnum('project_visibility', projectVisibilities);
export const projectRole = pgEnum('project_role', projectRoles);
export const statusCategory = pgEnum('status_category', statusCategories);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    visibility: projectVisibility('visibility').notNull().default('workspace'),
    /** When true, a task can't move to a done status while any blocker is still open. */
    enforceDependencies: boolean('enforce_dependencies').notNull().default(true),
    /** Last task number issued; incremented under a row lock to number tasks ENG-1, ENG-2, ... */
    taskCounter: integer('task_counter').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('projects_workspace_key_idx').on(t.workspaceId, t.key)],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index().on(t.userId)],
);

export const projectStatuses = pgTable(
  'project_statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: citext('name').notNull(),
    category: statusCategory('category').notNull(),
    color: text('color').notNull(),
    position: integer('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('project_statuses_name_idx').on(t.projectId, t.name)],
);

// ---- Labels ----

export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: citext('name').notNull(),
    color: text('color').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('labels_workspace_name_idx').on(t.workspaceId, t.name)],
);

// ---- Tasks ----

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    statusId: uuid('status_id')
      .notNull()
      .references(() => projectStatuses.id, { onDelete: 'restrict' }),
    /** 0 = none ... 4 = urgent, so it sorts numerically. */
    priority: smallint('priority').notNull().default(0),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: date('due_date', { mode: 'string' }),
    estimate: integer('estimate'),
    parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
    /** Board order within a status column (fractional indexing). */
    sortOrder: doublePrecision('sort_order').notNull(),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tasks_project_number_idx').on(t.projectId, t.number),
    index('tasks_board_idx').on(t.projectId, t.statusId, t.sortOrder),
    index().on(t.assigneeId),
    index().on(t.parentId),
    index('tasks_workspace_updated_idx').on(t.workspaceId, t.updatedAt),
    check('tasks_not_own_parent', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
    check('tasks_priority_range', sql`${t.priority} between 0 and 4`),
  ],
);

export const taskLabels = pgTable(
  'task_labels',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] }), index().on(t.labelId)],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [index('comments_task_created_idx').on(t.taskId, t.createdAt)],
);

export const commentMentions = pgTable(
  'comment_mentions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] }), index().on(t.userId)],
);

export const taskActivity = pgTable(
  'task_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>(),
    commentId: uuid('comment_id'),
    createdAt: createdAt(),
  },
  (t) => [index('task_activity_task_created_idx').on(t.taskId, t.createdAt)],
);

/** `blockerId` blocks `blockedId`. Both tasks are in the same workspace; projects may differ. */
export const taskDependencies = pgTable(
  'task_dependencies',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index().on(t.blockedId),
    check('task_dependencies_not_self', sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

// ---- Events (transactional outbox + sync log) ----

/**
 * Every change is recorded here in the same transaction as the change itself. The relay
 * publishes unpublished rows to real-time clients and background jobs; clients that were
 * offline catch up by reading events after the last `seq` they saw.
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Gap-free, per-workspace order, issued under the workspace row lock. */
    seq: bigint('seq', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    // Not foreign keys: events outlive the rows they describe (e.g. task.deleted).
    projectId: uuid('project_id'),
    taskId: uuid('task_id'),
    actorId: uuid('actor_id'),
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('events_workspace_seq_idx').on(t.workspaceId, t.seq),
    index('events_unpublished_idx')
      .on(t.createdAt)
      .where(sql`${t.publishedAt} is null`),
  ],
);

// ---- Watchers and notifications ----

export const taskWatchers = pgTable(
  'task_watchers',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] }), index().on(t.userId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    projectId: uuid('project_id'),
    taskId: uuid('task_id'),
    actorId: uuid('actor_id'),
    data: jsonb('data').notNull(),
    /** Identifies the cause (event + type), so retried fan-out jobs can't notify twice. */
    dedupeKey: text('dedupe_key').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('notifications_user_dedupe_idx').on(t.userId, t.dedupeKey),
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    index('notifications_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Notification types the user has turned off. */
  mutedTypes: text('muted_types')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  emailDigest: boolean('email_digest').notNull().default(true),
  updatedAt: updatedAt(),
});

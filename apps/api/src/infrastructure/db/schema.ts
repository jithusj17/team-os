import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspaceRoles } from '@team-os/shared';

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

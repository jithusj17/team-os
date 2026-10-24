import { randomBytes } from 'node:crypto';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Invite, InvitePreview, Member, Workspace, WorkspaceRole } from '@team-os/shared';
import type { Db } from '../../db/client.js';
import { users, workspaceInvites, workspaceMembers, workspaces } from '../../db/schema.js';
import { conflict, forbidden, gone, notFound } from '../../lib/errors.js';
import { hashToken, randomToken } from '../../lib/tokens.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = '23505';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function isUniqueViolation(err: unknown, constraint?: string) {
  // Drizzle wraps driver errors; the Postgres error is on `cause`.
  const pg = ((err as { cause?: unknown }).cause ?? err) as {
    code?: string;
    constraint_name?: string;
  };
  return pg.code === UNIQUE_VIOLATION && (!constraint || pg.constraint_name?.includes(constraint));
}

export function slugify(name: string) {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug.length >= 3 ? slug : `workspace-${slug}`.replace(/-+$/, '');
}

// ---- Workspaces ----

export async function listWorkspaces(db: Db, userId: string): Promise<Workspace[]> {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
      createdAt: workspaces.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.name));
}

export async function getWorkspace(db: Db, id: string, role: WorkspaceRole): Promise<Workspace> {
  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      createdAt: workspaces.createdAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, id));
  if (!row) throw notFound('workspace_not_found', 'Workspace not found');
  return { ...row, role };
}

export async function createWorkspace(
  db: Db,
  userId: string,
  input: { name: string; slug?: string },
): Promise<Workspace> {
  const explicitSlug = input.slug;
  const base = explicitSlug ?? slugify(input.name);

  // A derived slug gets a random suffix on collision; an explicit one is the user's choice.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 34)}-${randomBytes(3).toString('hex')}`;
    try {
      return await db.transaction(async (tx) => {
        const [ws] = await tx
          .insert(workspaces)
          .values({ name: input.name, slug, createdBy: userId })
          .returning();
        await tx.insert(workspaceMembers).values({ workspaceId: ws!.id, userId, role: 'owner' });
        return {
          id: ws!.id,
          name: ws!.name,
          slug: ws!.slug,
          createdAt: ws!.createdAt,
          role: 'owner',
        };
      });
    } catch (err) {
      if (!isUniqueViolation(err, 'slug')) throw err;
      if (explicitSlug) throw conflict('slug_taken', 'That workspace URL is already taken');
    }
  }
  throw conflict('slug_taken', 'Could not find an available workspace URL');
}

export async function updateWorkspace(
  db: Db,
  id: string,
  role: WorkspaceRole,
  input: { name?: string; slug?: string },
): Promise<Workspace> {
  try {
    await db.update(workspaces).set(input).where(eq(workspaces.id, id));
  } catch (err) {
    if (isUniqueViolation(err, 'slug')) {
      throw conflict('slug_taken', 'That workspace URL is already taken');
    }
    throw err;
  }
  return getWorkspace(db, id, role);
}

export async function deleteWorkspace(db: Db, id: string) {
  await db.delete(workspaces).where(eq(workspaces.id, id));
}

// ---- Members ----

export async function listMembers(db: Db, workspaceId: string): Promise<Member[]> {
  return db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(users.name));
}

export async function getMemberRole(
  db: Db | Tx,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  if (!row) throw notFound('member_not_found', 'Member not found');
  return row.role;
}

/**
 * Guarantees a workspace never loses its last owner. Locks the owner rows so two
 * concurrent demotions/removals can't both pass the check.
 */
async function assertNotLastOwner(tx: Tx, workspaceId: string, userId: string) {
  const owners = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')))
    .for('update');
  if (owners.length === 1 && owners[0]!.userId === userId) {
    throw conflict('last_owner', 'A workspace must have at least one owner');
  }
}

export async function changeMemberRole(
  db: Db,
  workspaceId: string,
  userId: string,
  newRole: WorkspaceRole,
) {
  await db.transaction(async (tx) => {
    const current = await getMemberRole(tx, workspaceId, userId);
    if (current === 'owner' && newRole !== 'owner') {
      await assertNotLastOwner(tx, workspaceId, userId);
    }
    await tx
      .update(workspaceMembers)
      .set({ role: newRole })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
  });
}

export async function removeMember(db: Db, workspaceId: string, userId: string) {
  await db.transaction(async (tx) => {
    const current = await getMemberRole(tx, workspaceId, userId);
    if (current === 'owner') await assertNotLastOwner(tx, workspaceId, userId);
    await tx
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
  });
}

// ---- Invites ----

const inviteColumns = {
  id: workspaceInvites.id,
  email: workspaceInvites.email,
  role: workspaceInvites.role,
  invitedBy: workspaceInvites.invitedBy,
  expiresAt: workspaceInvites.expiresAt,
  createdAt: workspaceInvites.createdAt,
};

const openInvite = and(isNull(workspaceInvites.acceptedAt), isNull(workspaceInvites.revokedAt));

export async function listOpenInvites(db: Db, workspaceId: string): Promise<Invite[]> {
  return db
    .select(inviteColumns)
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        openInvite,
        gt(workspaceInvites.expiresAt, sql`now()`),
      ),
    )
    .orderBy(asc(workspaceInvites.createdAt));
}

/** Creates an invite, replacing any open invite for the same email (i.e. a resend). */
export async function createInvite(
  db: Db,
  workspaceId: string,
  invitedBy: string,
  input: { email: string; role: WorkspaceRole },
): Promise<{ invite: Invite; token: string }> {
  const token = randomToken();
  const invite = await db.transaction(async (tx) => {
    const [existingMember] = await tx
      .select({ userId: users.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, input.email)));
    if (existingMember) throw conflict('already_member', 'This person is already a member');

    await tx
      .update(workspaceInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.email, input.email),
          openInvite,
        ),
      );
    const [row] = await tx
      .insert(workspaceInvites)
      .values({
        workspaceId,
        email: input.email,
        role: input.role,
        invitedBy,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning(inviteColumns);
    return row!;
  });
  return { invite, token };
}

export async function revokeInvite(db: Db, workspaceId: string, inviteId: string) {
  const updated = await db
    .update(workspaceInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceInvites.id, inviteId),
        eq(workspaceInvites.workspaceId, workspaceId),
        openInvite,
      ),
    )
    .returning({ id: workspaceInvites.id });
  if (updated.length === 0) throw notFound('invite_not_found', 'Invite not found');
}

function inviteStatus(row: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InvitePreview['status'] {
  if (row.acceptedAt) return 'accepted';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'pending';
}

export async function previewInvite(db: Db, token: string): Promise<InvitePreview> {
  const [row] = await db
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      invitedByName: users.name,
      expiresAt: workspaceInvites.expiresAt,
      acceptedAt: workspaceInvites.acceptedAt,
      revokedAt: workspaceInvites.revokedAt,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvites.invitedBy))
    .where(eq(workspaceInvites.tokenHash, hashToken(token)));
  if (!row) throw notFound('invite_not_found', 'Invite not found');
  const { acceptedAt: _a, revokedAt: _r, ...preview } = row;
  return { ...preview, status: inviteStatus(row) };
}

/** Accepts an invite for the signed-in user. The user's email must match the invited email. */
export async function acceptInvite(
  db: Db,
  token: string,
  user: { id: string; email: string },
): Promise<{ workspaceId: string }> {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.tokenHash, hashToken(token)))
      .for('update');
    if (!invite) throw notFound('invite_not_found', 'Invite not found');

    const status = inviteStatus(invite);
    if (status === 'accepted') throw conflict('invite_already_accepted', 'Invite already used');
    if (status === 'revoked') throw gone('invite_revoked', 'This invite was revoked');
    if (status === 'expired') throw gone('invite_expired', 'This invite has expired');

    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw forbidden(
        'invite_email_mismatch',
        `This invite was sent to ${invite.email}. Sign in with that account to accept it.`,
      );
    }

    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: invite.workspaceId, userId: user.id, role: invite.role })
      .onConflictDoNothing();
    await tx
      .update(workspaceInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(workspaceInvites.id, invite.id));
    return { workspaceId: invite.workspaceId };
  });
}

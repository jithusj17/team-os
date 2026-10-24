import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { users, workspaceInvites, workspaces } from '../../../infrastructure/db/schema.js';
import type { Invite } from '../domain/invite.js';
import type { InvitePreviewData, InviteRepository } from '../domain/ports.js';

const columns = {
  id: workspaceInvites.id,
  workspaceId: workspaceInvites.workspaceId,
  email: workspaceInvites.email,
  role: workspaceInvites.role,
  invitedBy: workspaceInvites.invitedBy,
  expiresAt: workspaceInvites.expiresAt,
  acceptedAt: workspaceInvites.acceptedAt,
  revokedAt: workspaceInvites.revokedAt,
  createdAt: workspaceInvites.createdAt,
};

const isOpen = and(isNull(workspaceInvites.acceptedAt), isNull(workspaceInvites.revokedAt));

export class DrizzleInviteRepository implements InviteRepository {
  constructor(private readonly db: DbExecutor) {}

  listOpen(workspaceId: string, now: Date): Promise<Invite[]> {
    return this.db
      .select(columns)
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          isOpen,
          gt(workspaceInvites.expiresAt, now),
        ),
      )
      .orderBy(asc(workspaceInvites.createdAt));
  }

  async create(data: Parameters<InviteRepository['create']>[0]): Promise<Invite> {
    const [row] = await this.db.insert(workspaceInvites).values(data).returning(columns);
    return row!;
  }

  async revokeOpenForEmail(workspaceId: string, email: string, now: Date) {
    await this.db
      .update(workspaceInvites)
      .set({ revokedAt: now })
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.email, email),
          isOpen,
        ),
      );
  }

  async revoke(workspaceId: string, inviteId: string, now: Date) {
    const rows = await this.db
      .update(workspaceInvites)
      .set({ revokedAt: now })
      .where(
        and(
          eq(workspaceInvites.id, inviteId),
          eq(workspaceInvites.workspaceId, workspaceId),
          isOpen,
        ),
      )
      .returning({ id: workspaceInvites.id });
    return rows.length > 0;
  }

  async lockByTokenHash(tokenHash: string) {
    const [row] = await this.db
      .select(columns)
      .from(workspaceInvites)
      .where(eq(workspaceInvites.tokenHash, tokenHash))
      .for('update');
    return row ?? null;
  }

  async findPreviewByTokenHash(tokenHash: string): Promise<InvitePreviewData | null> {
    const [row] = await this.db
      .select({ invite: columns, workspaceName: workspaces.name, invitedByName: users.name })
      .from(workspaceInvites)
      .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
      .leftJoin(users, eq(users.id, workspaceInvites.invitedBy))
      .where(eq(workspaceInvites.tokenHash, tokenHash));
    return row ?? null;
  }

  async markAccepted(inviteId: string, now: Date) {
    await this.db
      .update(workspaceInvites)
      .set({ acceptedAt: now })
      .where(eq(workspaceInvites.id, inviteId));
  }
}

import type { Invite } from './invite.js';
import type { Member } from './membership.js';
import type { Workspace, WorkspaceRole, WorkspaceView } from './workspace.js';

export interface WorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  listForUser(userId: string): Promise<WorkspaceView[]>;
  /** Throws a `slug_taken` conflict if the slug is in use. */
  create(data: { name: string; slug: string; createdBy: string }): Promise<Workspace>;
  /** Throws a `slug_taken` conflict if the slug is in use. */
  update(id: string, patch: { name?: string; slug?: string }): Promise<Workspace | null>;
  delete(id: string): Promise<void>;
}

export interface MemberRepository {
  findRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null>;
  list(workspaceId: string): Promise<Member[]>;
  isMemberByEmail(workspaceId: string, email: string): Promise<boolean>;
  /** Adds a member; does nothing if they are already one. */
  add(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
  updateRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void>;
  remove(workspaceId: string, userId: string): Promise<void>;
  /**
   * Returns the owners' user IDs and locks those rows until the transaction ends, so
   * concurrent demotions can't both pass the last-owner check.
   */
  lockOwnerIds(workspaceId: string): Promise<string[]>;
}

export interface InvitePreviewData {
  invite: Invite;
  workspaceName: string;
  invitedByName: string | null;
}

export interface InviteRepository {
  listOpen(workspaceId: string, now: Date): Promise<Invite[]>;
  create(
    data: Omit<Invite, 'id' | 'acceptedAt' | 'revokedAt' | 'createdAt'> & {
      tokenHash: string;
    },
  ): Promise<Invite>;
  /** Revokes any open invite for this email. */
  revokeOpenForEmail(workspaceId: string, email: string, now: Date): Promise<void>;
  /** Returns false if no open invite matched. */
  revoke(workspaceId: string, inviteId: string, now: Date): Promise<boolean>;
  /** Finds an invite by token hash and locks it until the transaction ends. */
  lockByTokenHash(tokenHash: string): Promise<Invite | null>;
  findPreviewByTokenHash(tokenHash: string): Promise<InvitePreviewData | null>;
  markAccepted(inviteId: string, now: Date): Promise<void>;
}

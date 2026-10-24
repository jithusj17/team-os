import { conflict, forbidden, gone } from '../../../shared/domain/errors.js';
import type { WorkspaceRole } from './workspace.js';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Invite {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export function inviteStatus(invite: Invite, now: Date): InviteStatus {
  if (invite.acceptedAt) return 'accepted';
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

/** Throws unless `invite` can be accepted right now by a user with `email`. */
export function assertAcceptable(invite: Invite, email: string, now: Date) {
  const status = inviteStatus(invite, now);
  if (status === 'accepted') throw conflict('invite_already_accepted', 'Invite already used');
  if (status === 'revoked') throw gone('invite_revoked', 'This invite was revoked');
  if (status === 'expired') throw gone('invite_expired', 'This invite has expired');
  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    throw forbidden(
      'invite_email_mismatch',
      `This invite was sent to ${invite.email}. Sign in with that account to accept it.`,
    );
  }
}

import { conflict } from '../../../shared/domain/errors.js';
import type { WorkspaceRole } from './workspace.js';

export interface Member {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  joinedAt: Date;
}

/**
 * A workspace must always keep at least one owner. Call with the current owners before
 * demoting or removing `userId`.
 */
export function assertNotLastOwner(ownerIds: string[], userId: string) {
  if (ownerIds.length === 1 && ownerIds[0] === userId) {
    throw conflict('last_owner', 'A workspace must have at least one owner');
  }
}

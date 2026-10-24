import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { canInWorkspace, type WorkspacePermissionCheck, type WorkspaceRole } from '@team-os/shared';
import type { Db } from '../db/client.js';
import { workspaceMembers } from '../db/schema.js';
import { requireAuth } from '../modules/auth/plugin.js';
import { forbidden, notFound } from './errors.js';

export async function getMembershipRole(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return row?.role ?? null;
}

/**
 * The single entry point for workspace authorization. Every workspace-scoped route calls this.
 * Non-members get 404 rather than 403 so workspace IDs can't be probed for existence.
 */
export async function authorizeWorkspace(
  req: FastifyRequest,
  workspaceId: string,
  check: WorkspacePermissionCheck,
): Promise<{ userId: string; role: WorkspaceRole }> {
  const { userId } = requireAuth(req);
  const role = await getMembershipRole(req.server.db, workspaceId, userId);
  if (!role) throw notFound('workspace_not_found', 'Workspace not found');
  if (!canInWorkspace(role, check)) throw forbidden();
  return { userId, role };
}

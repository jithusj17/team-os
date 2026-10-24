/** Socket.IO room names. Events go to project or workspace rooms; `user:` rooms target people. */
export const workspaceRoom = (id: string) => `workspace:${id}`;
export const projectRoom = (id: string) => `project:${id}`;
export const taskRoom = (id: string) => `task:${id}`;
export const userRoom = (id: string) => `user:${id}`;

/** The room an event is delivered to. */
export const roomForEvent = (event: { workspaceId: string; projectId: string | null }) =>
  event.projectId ? projectRoom(event.projectId) : workspaceRoom(event.workspaceId);

/** Events whose payload `{ userId, accessChanged: true }` means that user's access may have shrunk. */
export function accessRevokedUserId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as { userId?: unknown; accessChanged?: unknown };
  return p.accessChanged === true && typeof p.userId === 'string' ? p.userId : null;
}

/** A project's visibility changed, so anyone in its room may have lost access. */
export function projectAccessChanged(event: { type: string; payload: unknown }): boolean {
  const p = event.payload as { accessChanged?: unknown } | null;
  return event.type === 'project.updated' && p?.accessChanged === true;
}

/** How long a presence entry lives without a heartbeat. */
export const PRESENCE_TTL_SECONDS = 60;

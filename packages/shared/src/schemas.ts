import { z } from 'zod';
import { invitableRoles, workspaceRoles } from './permissions.js';

// Request and response shapes shared by the API and the web app.
// Timestamps use z.coerce.date(): the API serializes Dates to ISO strings, and clients parse them back.

export const workspaceRole = z.enum(workspaceRoles);
export const invitableRole = z.enum(invitableRoles);

export const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponse>;

// ---- Auth ----

export const oauthProviderName = z.enum(['google', 'github']);
export type OAuthProviderName = z.infer<typeof oauthProviderName>;

export const user = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type User = z.infer<typeof user>;

export const meResponse = z.object({ user, csrfToken: z.string() });
export type MeResponse = z.infer<typeof meResponse>;

export const providersResponse = z.object({
  providers: z.array(oauthProviderName),
  devLogin: z.boolean(),
});

export const devLoginBody = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(100).optional(),
});

// ---- Workspaces ----

export const workspaceSlug = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens');

export const workspace = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  role: workspaceRole,
  createdAt: z.coerce.date(),
});
export type Workspace = z.infer<typeof workspace>;

export const createWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(80),
  slug: workspaceSlug.optional(),
});

export const updateWorkspaceBody = z
  .object({ name: z.string().trim().min(1).max(80), slug: workspaceSlug })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field');

export const member = z.object({
  userId: z.uuid(),
  email: z.email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  role: workspaceRole,
  joinedAt: z.coerce.date(),
});
export type Member = z.infer<typeof member>;

export const updateMemberBody = z.object({ role: workspaceRole });

// ---- Invites ----

export const createInviteBody = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  role: invitableRole,
});

export const invite = z.object({
  id: z.uuid(),
  email: z.email(),
  role: workspaceRole,
  invitedBy: z.uuid().nullable(),
  expiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type Invite = z.infer<typeof invite>;

export const createInviteResponse = z.object({
  invite,
  /** Returned so admins can share the link directly while email delivery is not configured. */
  acceptUrl: z.url(),
});

export const invitePreview = z.object({
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  email: z.email(),
  role: workspaceRole,
  invitedByName: z.string().nullable(),
  expiresAt: z.coerce.date(),
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
});
export type InvitePreview = z.infer<typeof invitePreview>;

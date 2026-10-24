import type { OAuthProviderName } from '@team-os/shared';

export type { OAuthProviderName };

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/** What an identity provider tells us about the person signing in. */
export interface OAuthProfile {
  providerUserId: string;
  email: string;
  /** Only verified emails may be used to link to an existing account. */
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

/** Only same-site relative paths, so sign-in can't be used as an open redirect. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}

export const defaultNameFromEmail = (email: string) => email.split('@')[0] || email;

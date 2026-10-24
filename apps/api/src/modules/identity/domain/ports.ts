import type { OAuthProfile, OAuthProviderName, User } from './user.js';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByOAuthAccount(provider: OAuthProviderName, providerUserId: string): Promise<User | null>;
  create(data: Omit<User, 'id'>): Promise<User>;
  linkOAuthAccount(
    userId: string,
    provider: OAuthProviderName,
    providerUserId: string,
  ): Promise<void>;
}

export interface OAuthProvider {
  readonly name: OAuthProviderName;
  authorizationUrl(state: string, codeVerifier: string): URL;
  /** Exchanges an authorization code for the user's profile. Throws if the code is invalid. */
  exchange(code: string, codeVerifier: string): Promise<OAuthProfile>;
}

export interface Session {
  userId: string;
  csrfToken: string;
}

export interface SessionStore {
  create(userId: string): Promise<{ token: string; session: Session }>;
  /** Returns the live session for `token`, or null if it is unknown or expired. */
  get(token: string): Promise<Session | null>;
  destroy(token: string): Promise<void>;
}

export interface PendingOAuthLogin {
  provider: OAuthProviderName;
  codeVerifier: string;
  returnTo: string;
}

/** How long a user has to complete an OAuth sign-in once started. */
export const OAUTH_STATE_TTL_SECONDS = 600;

/** Short-lived, single-use storage for in-flight OAuth sign-ins. */
export interface OAuthStateStore {
  save(state: string, pending: PendingOAuthLogin): Promise<void>;
  /** Returns and deletes the pending sign-in, so each state can be used once. */
  consume(state: string): Promise<PendingOAuthLogin | null>;
}

import type { OAuthProviderName } from '@team-os/shared';
import type { TokenService } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { DomainError, notFound, unauthorized } from '../../../shared/domain/errors.js';
import type {
  OAuthProvider,
  OAuthStateStore,
  SessionStore,
  UserRepository,
} from '../domain/ports.js';
import { safeReturnTo, type OAuthProfile, type User } from '../domain/user.js';

/** Error codes for failed sign-ins; the HTTP layer turns these into login-page messages. */
export type SignInFailure = 'invalid_state' | 'oauth_failed' | 'email_unverified';

const signInFailed = (code: SignInFailure, message: string) => unauthorized(code, message);

export class OAuthProviderRegistry {
  private readonly providers: Map<OAuthProviderName, OAuthProvider>;

  constructor(providers: OAuthProvider[]) {
    this.providers = new Map(providers.map((p) => [p.name, p]));
  }

  names() {
    return [...this.providers.keys()];
  }

  get(name: OAuthProviderName): OAuthProvider {
    const provider = this.providers.get(name);
    if (!provider) throw notFound('provider_not_configured', `Sign-in with ${name} is not enabled`);
    return provider;
  }
}

export class StartOAuthSignIn {
  constructor(
    private readonly deps: {
      providers: OAuthProviderRegistry;
      stateStore: OAuthStateStore;
      tokens: TokenService;
    },
  ) {}

  /** Returns the provider URL to redirect to, and the state to bind to the browser. */
  async execute(input: { provider: OAuthProviderName; returnTo?: string }) {
    const provider = this.deps.providers.get(input.provider);
    const state = this.deps.tokens.generate();
    const codeVerifier = this.deps.tokens.generate();
    await this.deps.stateStore.save(state, {
      provider: provider.name,
      codeVerifier,
      returnTo: safeReturnTo(input.returnTo),
    });
    return { state, authorizationUrl: provider.authorizationUrl(state, codeVerifier).toString() };
  }
}

export class CompleteOAuthSignIn {
  constructor(
    private readonly deps: {
      providers: OAuthProviderRegistry;
      stateStore: OAuthStateStore;
      sessions: SessionStore;
      uow: UnitOfWork<{ users: UserRepository }>;
    },
  ) {}

  async execute(input: {
    provider: OAuthProviderName;
    code: string;
    state: string;
    /** The state stored in the browser's cookie when the sign-in started. */
    browserState: string | undefined;
    currentSessionToken?: string;
  }): Promise<{ user: User; sessionToken: string; returnTo: string }> {
    const provider = this.deps.providers.get(input.provider);

    // Binding the state to the browser prevents login CSRF (an attacker completing the
    // flow with their own account in the victim's browser). Consuming it makes it single-use.
    if (!input.browserState || input.browserState !== input.state) {
      throw signInFailed('invalid_state', 'Sign-in session mismatch');
    }
    const pending = await this.deps.stateStore.consume(input.state);
    if (!pending || pending.provider !== provider.name) {
      throw signInFailed('invalid_state', 'Sign-in session expired');
    }

    let profile: OAuthProfile;
    try {
      profile = await provider.exchange(input.code, pending.codeVerifier);
    } catch (cause) {
      const err = signInFailed('oauth_failed', 'The identity provider rejected the sign-in');
      err.cause = cause;
      throw err;
    }

    const user = await this.findOrCreateUser(provider.name, profile);

    // A fresh session on every sign-in prevents session fixation.
    if (input.currentSessionToken) await this.deps.sessions.destroy(input.currentSessionToken);
    const { token } = await this.deps.sessions.create(user.id);
    return { user, sessionToken: token, returnTo: pending.returnTo };
  }

  /**
   * 1. A known provider account signs in its user.
   * 2. Otherwise a *verified* email links the provider to the existing user with that email.
   * 3. Otherwise a new user is created.
   */
  private findOrCreateUser(provider: OAuthProviderName, profile: OAuthProfile) {
    return this.deps.uow.transaction(async ({ users }) => {
      const linked = await users.findByOAuthAccount(provider, profile.providerUserId);
      if (linked) return linked;

      // Linking on an unverified email would let anyone claim another person's account.
      if (!profile.emailVerified) {
        throw signInFailed('email_unverified', 'Your email address is not verified');
      }

      const user =
        (await users.findByEmail(profile.email)) ??
        (await users.create({
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
        }));
      await users.linkOAuthAccount(user.id, provider, profile.providerUserId);
      return user;
    });
  }
}

export const isSignInFailure = (err: unknown): err is DomainError & { code: SignInFailure } =>
  err instanceof DomainError &&
  ['invalid_state', 'oauth_failed', 'email_unverified'].includes(err.code);

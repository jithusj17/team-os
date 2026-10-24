import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { unauthorized } from '../../../shared/domain/errors.js';
import type { SessionStore, UserRepository } from '../domain/ports.js';
import { defaultNameFromEmail, type User } from '../domain/user.js';

/** Development-only sign-in by email. The HTTP layer only exposes it when enabled. */
export class DevSignIn {
  constructor(
    private readonly deps: { uow: UnitOfWork<{ users: UserRepository }>; sessions: SessionStore },
  ) {}

  async execute(input: { email: string; name?: string; currentSessionToken?: string }) {
    const user = await this.deps.uow.transaction(
      async ({ users }) =>
        (await users.findByEmail(input.email)) ??
        users.create({
          email: input.email,
          name: input.name ?? defaultNameFromEmail(input.email),
          avatarUrl: null,
        }),
    );
    if (input.currentSessionToken) await this.deps.sessions.destroy(input.currentSessionToken);
    const { token, session } = await this.deps.sessions.create(user.id);
    return { user, sessionToken: token, csrfToken: session.csrfToken };
  }
}

export class GetCurrentUser {
  constructor(
    private readonly deps: { uow: UnitOfWork<{ users: UserRepository }>; sessions: SessionStore },
  ) {}

  async execute(input: { userId: string; sessionToken: string }): Promise<User> {
    const user = await this.deps.uow.repos.users.findById(input.userId);
    if (!user) {
      // The user was deleted while the session was still alive.
      await this.deps.sessions.destroy(input.sessionToken);
      throw unauthorized();
    }
    return user;
  }
}

export class SignOut {
  constructor(private readonly deps: { sessions: SessionStore }) {}

  async execute(input: { sessionToken?: string }) {
    if (input.sessionToken) await this.deps.sessions.destroy(input.sessionToken);
  }
}

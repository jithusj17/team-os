import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { oauthAccounts, users } from '../../../infrastructure/db/schema.js';
import type { UserRepository } from '../domain/ports.js';
import type { OAuthProviderName, User } from '../domain/user.js';

const columns = {
  id: users.id,
  email: users.email,
  name: users.name,
  avatarUrl: users.avatarUrl,
};

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: DbExecutor) {}

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select(columns).from(users).where(eq(users.id, id));
    return row ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.db.select(columns).from(users).where(eq(users.email, email));
    return row ?? null;
  }

  async findByOAuthAccount(provider: OAuthProviderName, providerUserId: string) {
    const [row] = await this.db
      .select(columns)
      .from(oauthAccounts)
      .innerJoin(users, eq(users.id, oauthAccounts.userId))
      .where(
        and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, providerUserId)),
      );
    return row ?? null;
  }

  async create(data: Omit<User, 'id'>): Promise<User> {
    const [row] = await this.db.insert(users).values(data).returning(columns);
    return row!;
  }

  async linkOAuthAccount(userId: string, provider: OAuthProviderName, providerUserId: string) {
    await this.db.insert(oauthAccounts).values({ userId, provider, providerUserId });
  }
}

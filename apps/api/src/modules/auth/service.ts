import { and, eq } from 'drizzle-orm';
import type { User } from '@team-os/shared';
import type { Db } from '../../db/client.js';
import { oauthAccounts, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import type { OAuthProfile, OAuthProvider } from './providers.js';

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  avatarUrl: users.avatarUrl,
};

export async function getUser(db: Db, id: string): Promise<User | null> {
  const [row] = await db.select(userColumns).from(users).where(eq(users.id, id));
  return row ?? null;
}

/**
 * Finds or creates the user for an OAuth sign-in:
 * 1. a known provider account signs in its user;
 * 2. otherwise a *verified* email links the provider to the existing user with that email;
 * 3. otherwise a new user is created.
 */
export async function upsertOAuthUser(
  db: Db,
  provider: OAuthProvider['name'],
  profile: OAuthProfile,
): Promise<User> {
  return db.transaction(async (tx) => {
    const [linked] = await tx
      .select(userColumns)
      .from(oauthAccounts)
      .innerJoin(users, eq(users.id, oauthAccounts.userId))
      .where(
        and(
          eq(oauthAccounts.provider, provider),
          eq(oauthAccounts.providerUserId, profile.providerUserId),
        ),
      );
    if (linked) return linked;

    // Linking on an unverified email would let anyone claim another person's account.
    if (!profile.emailVerified) {
      throw new AppError(403, 'email_unverified', 'Your email address is not verified');
    }

    let [user] = await tx.select(userColumns).from(users).where(eq(users.email, profile.email));
    if (!user) {
      [user] = await tx
        .insert(users)
        .values({ email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl })
        .returning(userColumns);
    }
    await tx
      .insert(oauthAccounts)
      .values({ provider, providerUserId: profile.providerUserId, userId: user!.id });
    return user!;
  });
}

/** Development-only sign-in by email. */
export async function upsertUserByEmail(db: Db, email: string, name?: string): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ email, name: name ?? email.split('@')[0]! })
    .onConflictDoUpdate({ target: users.email, set: { email } })
    .returning(userColumns);
  return user!;
}

import { inArray } from 'drizzle-orm';
import type { NotificationPreferences, NotificationType } from '@team-os/shared';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { notificationPreferences } from '../../../infrastructure/db/schema.js';
import { DEFAULT_PREFERENCES, type PreferenceRepository } from '../domain/ports.js';

const toPrefs = (row: { mutedTypes: string[]; emailDigest: boolean }): NotificationPreferences => ({
  mutedTypes: row.mutedTypes as NotificationType[],
  emailDigest: row.emailDigest,
});

export class DrizzlePreferenceRepository implements PreferenceRepository {
  constructor(private readonly db: DbExecutor) {}

  async get(userId: string) {
    return (await this.getMany([userId])).get(userId) ?? DEFAULT_PREFERENCES;
  }

  async getMany(userIds: string[]) {
    if (userIds.length === 0) return new Map<string, NotificationPreferences>();
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, userIds));
    return new Map(rows.map((r) => [r.userId, toPrefs(r)]));
  }

  async set(userId: string, prefs: NotificationPreferences) {
    const [row] = await this.db
      .insert(notificationPreferences)
      .values({ userId, ...prefs })
      .onConflictDoUpdate({ target: notificationPreferences.userId, set: prefs })
      .returning();
    return toPrefs(row!);
  }
}

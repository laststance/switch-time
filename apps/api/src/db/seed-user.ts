import { DEFAULT_ACTIVITIES } from '@switch-time/shared'

import { db, type Executor } from './client'
import { activities, userSettings } from './schema/app'

/**
 * First-launch data for a new account: the 6 default activities in palette order plus a settings row.
 * Called from Better Auth's `user.create.after` hook (src/auth.ts) and from the readers that repair a half-seeded
 * account ({@link getSettings}, `activities.list`), so every insert ignores conflicts: seeding twice is a no-op.
 * @param executor - `db`, or the caller's transaction (a savepoint inside it), so a repair made under the user's lock
 *   uses the lock's connection instead of waiting for a second one.
 * @example await seedUser(user.id)
 */
export async function seedUser(
  userId: string,
  executor: Executor = db,
): Promise<void> {
  await executor.transaction(async (tx) => {
    await tx.insert(userSettings).values({ userId }).onConflictDoNothing()
    await tx
      .insert(activities)
      .values(
        DEFAULT_ACTIVITIES.map((activity, position) => ({
          userId,
          name: activity.name,
          color: activity.color,
          iconKey: activity.iconKey,
          targetHours: activity.target,
          position,
        })),
      )
      .onConflictDoNothing()
  })
}

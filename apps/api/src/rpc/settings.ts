import { settingsUpdateSchema, type SettingsUpdate } from '@switch-time/shared'
import { eq } from 'drizzle-orm'

import { db } from '../db/client'
import { userSettings } from '../db/schema/app'
import { seedUser } from '../db/seed-user'

import { authed, one, withUserLock, type Executor } from './base'

/**
 * The user's settings row (time zone, idle threshold…); seeded at sign-up, so a miss is a bug rather than a first-launch case.
 * @param executor - `db`, or the locked transaction of a timeline write, which reads the zone it decides on (and repairs a
 *   missing row) on its own connection.
 * @example const { timeZone } = await getSettings(context.user.id)
 */
export async function getSettings(userId: string, executor: Executor = db) {
  const rows = await executor
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
  // No row means the sign-up hook never ran to completion (or the account predates the domain tables): seed now, once.
  if (rows.length === 0) {
    await seedUser(userId, executor)
    return getSettings(userId, executor)
  }
  return one(rows)
}

// The settings row, created first when missing: a half-seeded account has no row to update, and .returning() would come back
// empty (NOT_FOUND). Settings only: seedUser would also insert the default activities, which this route has no business creating.
async function updateSettings(
  userId: string,
  input: SettingsUpdate,
  executor: Executor,
) {
  await executor.insert(userSettings).values({ userId }).onConflictDoNothing()
  return one(
    await executor
      .update(userSettings)
      .set(input)
      .where(eq(userSettings.userId, userId))
      .returning(),
  )
}

export const settingsRouter = {
  get: authed.handler(async ({ context }) => getSettings(context.user.id)),
  update: authed
    .input(settingsUpdateSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      // A zone change moves every day's window, so it waits for (and holds off) the timeline's writes, which read the zone.
      if (input.timeZone === undefined) return updateSettings(userId, input, db)
      return withUserLock(userId, async (tx) =>
        updateSettings(userId, input, tx),
      )
    }),
}

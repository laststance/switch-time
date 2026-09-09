import { settingsUpdateSchema } from '@switch-time/shared'
import { eq } from 'drizzle-orm'

import { db } from '../db/client'
import { userSettings } from '../db/schema/app'

import { authed, one } from './base'

/**
 * The user's settings row (time zone, idle threshold…); seeded at sign-up, so a miss is a bug rather than a first-launch case.
 * @example const { timeZone } = await getSettings(context.user.id)
 */
export async function getSettings(userId: string) {
  return one(
    await db.select().from(userSettings).where(eq(userSettings.userId, userId)),
  )
}

export const settingsRouter = {
  get: authed.handler(async ({ context }) => getSettings(context.user.id)),
  update: authed
    .input(settingsUpdateSchema)
    .handler(async ({ context, input }) =>
      one(
        await db
          .update(userSettings)
          .set(input)
          .where(eq(userSettings.userId, context.user.id))
          .returning(),
      ),
    ),
}

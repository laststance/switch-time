import { daySchema } from '@switch-time/shared'
import { and, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db/client'
import { excludedDays } from '../db/schema/app'

import { authed, boundedTransaction, one } from './base'

const dayInput = z.object({ day: daySchema })

export const excludedDaysRouter = {
  // Manual exclusions only; `auto_unused` days are computed per request by stats.*.
  list: authed
    .input(z.object({ from: daySchema, to: daySchema }))
    .handler(async ({ context, input }) =>
      db
        .select({ day: excludedDays.day, reason: excludedDays.reason })
        .from(excludedDays)
        .where(
          and(
            eq(excludedDays.userId, context.user.id),
            gte(excludedDays.day, input.from),
            lte(excludedDays.day, input.to),
          ),
        )
        .orderBy(excludedDays.day),
    ),

  exclude: authed.input(dayInput).handler(async ({ context, input }) =>
    boundedTransaction(context.deadline, async (tx) =>
      one(
        await tx
          .insert(excludedDays)
          .values({ userId: context.user.id, day: input.day, reason: 'manual' })
          .onConflictDoUpdate({
            target: [excludedDays.userId, excludedDays.day],
            set: { reason: 'manual' },
          })
          .returning({ day: excludedDays.day, reason: excludedDays.reason }),
      ),
    ),
  ),

  include: authed.input(dayInput).handler(async ({ context, input }) => {
    await boundedTransaction(context.deadline, async (tx) =>
      tx
        .delete(excludedDays)
        .where(
          and(
            eq(excludedDays.userId, context.user.id),
            eq(excludedDays.day, input.day),
          ),
        ),
    )
    return { day: input.day }
  }),
}

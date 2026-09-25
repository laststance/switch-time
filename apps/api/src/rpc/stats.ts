import {
  addDays,
  dayBounds,
  daySchema,
  daysInMonth,
  detoxCarriedDays,
  localDay,
  monthSchema,
  STREAK_CAP_DAYS,
  summarizeDays,
} from '@switch-time/shared'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { excludedDays, switches } from '../db/schema/app'

import { authed, boundedTransaction } from './base'
import { getSettings } from './settings'

// Totals, streak and exclusions for `count` days from `first`, all in the user's own time zone.
async function rangeStats(
  userId: string,
  first: string,
  count: number,
  deadline: number,
) {
  const settings = await getSettings(userId)
  const { timeZone } = settings
  const now = Date.now()
  const { start } = dayBounds(first, timeZone)
  const { end } = dayBounds(addDays(first, count - 1), timeZone)
  const today = localDay(new Date(now), timeZone)
  // Both reads on one connection and one snapshot: one connection per request, and exclusions that match the timeline.
  const { tapped, manual } = await boundedTransaction(
    deadline,
    async (tx) => ({
      // Every tap, oldest first, in one read: the window's timeline and which days count both come from it, so an edit
      // landing between two reads cannot pair an old timeline with new day classes (a work record turned detox counting
      // both ways). Folded into local days below with the same ICU zone math as dayBounds: Postgres names some zones
      // differently (ICU's `Asia/Calcutta` is unknown there) and reads `+09:00` POSIX-style, so it must not take part.
      // ponytail: loads one row per tap ever made; keep a per-day table when an account passes ~100k taps.
      tapped: await tx
        .select({
          id: switches.id,
          startedAt: switches.startedAt,
          activityId: switches.activityId,
        })
        .from(switches)
        .where(eq(switches.userId, userId))
        .orderBy(asc(switches.startedAt)),
      manual: await tx
        .select({ day: excludedDays.day })
        .from(excludedDays)
        .where(eq(excludedDays.userId, userId)),
    }),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
  // The window's rows plus its neighbours, as switchesBetween reads them: the state carried in and the switch that closes the last row.
  const carriedIn =
    tapped.findLast((row) => row.startedAt.getTime() < start) ?? null
  const carriedOut =
    tapped.find((row) => row.startedAt.getTime() >= end) ?? null
  const windowRows = tapped.filter(
    (row) => row.startedAt.getTime() >= start && row.startedAt.getTime() < end,
  )
  const switchDays = new Set(
    tapped.map((row) => localDay(row.startedAt, timeZone)),
  )
  // Detox days matter to the requested days and to the streak's walk back from today, whichever reaches further.
  const streakFloor = addDays(today, -STREAK_CAP_DAYS)
  const detoxDays = detoxCarriedDays(
    tapped.map((row) => ({
      activityId: row.activityId,
      startedAt: row.startedAt.getTime(),
    })),
    timeZone,
    { from: first < streakFloor ? first : streakFloor, to: today },
  )
  const rows = [carriedIn, ...windowRows, carriedOut]
  return summarizeDays({
    days: Array.from({ length: count }, (_, index) => addDays(first, index)),
    switches: rows.flatMap((row) =>
      row
        ? [
            {
              id: row.id,
              activityId: row.activityId,
              startedAt: row.startedAt.getTime(),
            },
          ]
        : [],
    ),
    facts: {
      switchDays,
      detoxDays,
      manualExcluded: new Set(manual.map((row) => row.day)),
      firstDay: [...switchDays].sort()[0] ?? null,
      today,
      autoExcludeUnusedDays: settings.autoExcludeUnusedDays,
    },
    timeZone,
    now,
    idleThresholdMs: settings.idleThresholdMinutes * 60_000,
  })
}

export const statsRouter = {
  day: authed
    .input(z.object({ day: daySchema }))
    .handler(async ({ context, input }) =>
      rangeStats(context.user.id, input.day, 1, context.deadline),
    ),
  week: authed
    .input(z.object({ startDay: daySchema }))
    .handler(async ({ context, input }) =>
      rangeStats(context.user.id, input.startDay, 7, context.deadline),
    ),
  month: authed
    .input(z.object({ month: monthSchema }))
    .handler(async ({ context, input }) =>
      rangeStats(
        context.user.id,
        `${input.month}-01`,
        daysInMonth(input.month),
        context.deadline,
      ),
    ),
}

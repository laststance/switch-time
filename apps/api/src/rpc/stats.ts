import {
  addDays,
  dayBounds,
  daySchema,
  daysInMonth,
  localDay,
  monthSchema,
  summarizeDays,
} from '@switch-time/shared'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db/client'
import { excludedDays, switches } from '../db/schema/app'

import { authed } from './base'
import { getSettings } from './settings'
import { switchesBetween } from './switches'

// Totals, streak and exclusions for `count` days from `first`, all in the user's own time zone.
async function rangeStats(userId: string, first: string, count: number) {
  const settings = await getSettings(userId)
  const { timeZone } = settings
  const now = Date.now()
  const { start } = dayBounds(first, timeZone)
  const { end } = dayBounds(addDays(first, count - 1), timeZone)
  const [timeline, tapped, manual] = await Promise.all([
    switchesBetween(userId, start, end),
    // Every tap's instant, folded into local days below with the same ICU zone math as dayBounds: Postgres names some
    // zones differently (ICU's `Asia/Calcutta` is unknown there) and reads `+09:00` POSIX-style, so it must not take part.
    // ponytail: loads one timestamp per tap ever made; keep a per-day table when an account passes ~100k taps.
    db
      .select({ startedAt: switches.startedAt })
      .from(switches)
      .where(eq(switches.userId, userId)),
    db
      .select({ day: excludedDays.day })
      .from(excludedDays)
      .where(eq(excludedDays.userId, userId)),
  ])
  const switchDays = new Set(
    tapped.map((row) => localDay(row.startedAt, timeZone)),
  )
  const rows = [timeline.carriedIn, ...timeline.rows, timeline.carriedOut]
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
      manualExcluded: new Set(manual.map((row) => row.day)),
      firstDay: [...switchDays].sort()[0] ?? null,
      today: localDay(new Date(now), timeZone),
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
      rangeStats(context.user.id, input.day, 1),
    ),
  week: authed
    .input(z.object({ startDay: daySchema }))
    .handler(async ({ context, input }) =>
      rangeStats(context.user.id, input.startDay, 7),
    ),
  month: authed
    .input(z.object({ month: monthSchema }))
    .handler(async ({ context, input }) =>
      rangeStats(
        context.user.id,
        `${input.month}-01`,
        daysInMonth(input.month),
      ),
    ),
}

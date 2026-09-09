import {
  addDays,
  dayBounds,
  daySchema,
  daysInMonth,
  localDay,
  monthSchema,
  summarizeDays,
} from '@switch-time/shared'
import { eq, sql } from 'drizzle-orm'
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
    // Distinct local days with a tap, for the streak and 計測なし; Postgres shifts zones so DST agrees with dayBounds.
    db
      .selectDistinct({
        day: sql<string>`to_char(${switches.startedAt} at time zone ${timeZone}, 'YYYY-MM-DD')`,
      })
      .from(switches)
      .where(eq(switches.userId, userId)),
    db
      .select({ day: excludedDays.day })
      .from(excludedDays)
      .where(eq(excludedDays.userId, userId)),
  ])
  const switchDays = new Set(tapped.map((row) => row.day))
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

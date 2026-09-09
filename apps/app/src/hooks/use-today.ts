import { dayBounds, localDay } from '@switch-time/shared'
import { useQuery } from '@tanstack/react-query'

import { orpc } from '@/lib/orpc'
import { countSwitches, daySegments } from '@/lib/today'
import { useAppSelector } from '@/store'

// The settings row's own defaults, used only until it has loaded.
const DEFAULTS = { timeZone: 'Asia/Tokyo', idleThresholdMinutes: 720 }

/**
 * Today as the API sees it (the stored `settings.timeZone`, not the device's): the calendar day, its bounds, the 24-h bar's segments
 * from `switches.listByDay` sliced against the ticking clock, and how many times the user switched today.
 * @example const { today, timeZone, segments, switchCount } = useToday()
 */
export function useToday() {
  const settings = useQuery(orpc.settings.get.queryOptions())
  const { timeZone, idleThresholdMinutes } = settings.data ?? DEFAULTS
  const now = useAppSelector((s) => s.clock.now)
  const today = localDay(new Date(now), timeZone)
  // The day query waits for the zone: asking for the device's "today" first would fetch the wrong day near midnight.
  const day = useQuery(
    orpc.switches.listByDay.queryOptions({
      input: { day: today },
      enabled: settings.data !== undefined,
    }),
  )
  const { start, end } = dayBounds(today, timeZone)
  return {
    today,
    timeZone,
    start,
    end,
    segments: daySegments(
      day.data,
      start,
      end,
      now,
      idleThresholdMinutes * 60_000,
    ),
    switchCount: countSwitches(day.data),
  }
}

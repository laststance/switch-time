import { localDay } from '@switch-time/shared'
import { useQuery } from '@tanstack/react-query'

import { orpc } from '@/lib/orpc'
import { useAppSelector } from '@/store'

// The settings row's own defaults, used only until it has loaded.
const DEFAULTS = { timeZone: 'Asia/Tokyo', idleThresholdMinutes: 720 }

/**
 * Today's calendar day as the API sees it (the stored `settings.timeZone`, not the device's). The selector returns the day string,
 * so screens re-render at midnight rather than every clock tick; `ready` gates queries keyed by the day, so nothing fetches the
 * device's "today" first.
 * @example const { today, ready } = useLocalToday()
 */
export function useLocalToday() {
  const settings = useQuery(orpc.settings.get.queryOptions())
  const { timeZone, idleThresholdMinutes } = settings.data ?? DEFAULTS
  const today = useAppSelector((s) => localDay(new Date(s.clock.now), timeZone))
  return {
    today,
    timeZone,
    idleThresholdMinutes,
    ready: settings.data !== undefined,
  }
}

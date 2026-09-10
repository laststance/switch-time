import { localDay } from '@switch-time/shared'

import { useSettings } from '@/hooks/use-settings'
import { useAppSelector } from '@/store'

/**
 * Today's calendar day as the API sees it (the stored `settings.timeZone`, not the device's). The selector returns the day string,
 * so screens re-render at midnight rather than every clock tick; `ready` gates queries keyed by the day, so nothing fetches the
 * device's "today" first.
 * @example const { today, ready } = useLocalToday()
 */
export function useLocalToday() {
  const { settings, ready } = useSettings()
  const today = useAppSelector((s) =>
    localDay(new Date(s.clock.now), settings.timeZone),
  )
  return {
    today,
    timeZone: settings.timeZone,
    idleThresholdMinutes: settings.idleThresholdMinutes,
    ready,
  }
}

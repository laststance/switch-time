import { focusManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import { deviceZone } from '@/lib/device-zone'

/**
 * This device's IANA zone, re-read each time the app returns to the foreground: the query client's focus signal (`AppState`
 * 'active' on native, `visibilitychange` on the web, see `src/lib/query.ts`), the same moment settings refetch. A zone change
 * while the app stays open (a flight, a manual change) so reaches {@link useTimeZoneSync} and 設定's タイムゾーン row without a relaunch.
 * @example const device = useDeviceZone() // 'Asia/Tokyo'
 */
export function useDeviceZone(): string {
  return useSyncExternalStore(subscribeToForeground, readZone, readZone)
}

// The zone last read. React reads the snapshot on every render, and only a foreground can change it, so the Intl lookup
// (dearer on Hermes than on V8) runs once per foreground instead of once per render.
let lastReadZone = deviceZone()

const readZone = (): string => lastReadZone

const subscribeToForeground = (onChange: () => void): (() => void) =>
  focusManager.subscribe(() => {
    lastReadZone = deviceZone()
    onChange()
  })

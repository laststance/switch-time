import { useEffect } from 'react'

import { useSettings, useUpdateSettings } from '@/hooks/use-settings'

// Browsers and Hermes both answer with the device's IANA zone; JS has no other source for it.
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone

/**
 * Writes the device's zone into `settings.timeZone` once the row has loaded and disagrees (a new account starts on Asia/Tokyo, a move
 * changes the device), so every day boundary the API computes follows the user's clock. A failed write waits for the next launch.
 * @example useTimeZoneSync()
 */
export function useTimeZoneSync() {
  const { settings, ready } = useSettings()
  const { mutate, isError } = useUpdateSettings()
  useEffect(() => {
    // `isError` breaks the loop a rollback would otherwise start (the old zone is back in the cache, so write it again).
    if (ready && !isError && settings.timeZone !== deviceZone)
      mutate({ timeZone: deviceZone })
  }, [ready, isError, settings.timeZone, mutate])
}

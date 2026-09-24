import { useIsMutating } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useSettings, useUpdateSettings } from '@/hooks/use-settings'
import { authClient } from '@/lib/auth-client'
import { readSyncedZone, rememberSyncedZone } from '@/lib/device-zone'
import { orpc } from '@/lib/orpc'
import { zoneSyncAction } from '@/lib/settings'

// Browsers and Hermes both answer with the device's IANA zone; JS has no other source for it.
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone

/**
 * Writes the device's zone into `settings.timeZone` when this device's zone changed since it last synced the account (a fresh
 * install, a move), so every day boundary the API computes follows the user's clock, while two devices in different zones
 * leave each other's write alone ({@link zoneSyncAction}). A failed write waits for the next launch. Mounted once, in the root layout.
 * @example useTimeZoneSync()
 */
export function useTimeZoneSync(): void {
  const { settings, ready } = useSettings()
  const { data: session } = authClient.useSession()
  const accountId = session?.user.id
  const { mutate, isError } = useUpdateSettings()
  const writing = useIsMutating({ mutationKey: orpc.settings.key() }) > 0
  // `isError` breaks the loop a rollback would otherwise start (the old zone is back in the cache, so write it again). Without an
  // account id (an expired session, a sign-out from another tab) the device's store cannot be read, and a write would only fail.
  const settled = ready && !isError && !writing && Boolean(accountId)
  useEffect(() => {
    const action = zoneSyncAction({
      stored: settings.timeZone,
      device: deviceZone,
      lastSynced: readSyncedZone(accountId),
      settled,
    })
    if (action === 'record') rememberSyncedZone(accountId, deviceZone)
    if (action === 'write')
      mutate(
        { timeZone: deviceZone },
        { onSuccess: () => rememberSyncedZone(accountId, deviceZone) },
      )
  }, [settled, settings.timeZone, accountId, mutate])
}

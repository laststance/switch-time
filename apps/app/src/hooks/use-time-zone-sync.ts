import { useIsMutating } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useDeviceZone } from '@/hooks/use-device-zone'
import { useSettings, useUpdateSettings } from '@/hooks/use-settings'
import { authClient } from '@/lib/auth-client'
import { readSyncedZone, rememberSyncedZone } from '@/lib/device-zone'
import { orpc } from '@/lib/orpc'
import { zoneSyncAction } from '@/lib/settings'

/**
 * Writes the device's zone into `settings.timeZone` when this device's zone changed since it last synced the account (a fresh
 * install, a move, also while the app stays open), so every day boundary the API computes follows the user's clock, while two
 * devices in different zones leave each other's write alone ({@link zoneSyncAction}). It acts only on a settings row that is
 * the session account's own. A failed write waits for the next launch or the next account. Mounted once, in the root layout.
 * @example useTimeZoneSync()
 */
export function useTimeZoneSync(): void {
  const { settings, ready, owner } = useSettings()
  const device = useDeviceZone()
  const { data: session } = authClient.useSession()
  const accountId = session?.user.id
  const { mutate, isError, reset } = useUpdateSettings()
  const writing = useIsMutating({ mutationKey: orpc.settings.key() }) > 0
  // `isError` breaks the loop a rollback would otherwise start (the old zone is back in the cache, so write it again). Without an
  // account id (an expired session, a sign-out from another tab) the device's store cannot be read, and a write would only fail.
  const settled = ready && !isError && !writing && Boolean(accountId)
  // The failure belongs to the account it was written for: the next account's sync must not stay off because of it.
  useEffect(() => reset(), [accountId, reset])
  useEffect(() => {
    const action = zoneSyncAction({
      stored: settings.timeZone,
      device,
      lastSynced: readSyncedZone(accountId),
      settled,
      account: accountId,
      rowAccount: owner,
    })
    if (action === 'record') rememberSyncedZone(accountId, device)
    if (action === 'write')
      mutate(
        { timeZone: device },
        { onSuccess: () => rememberSyncedZone(accountId, device) },
      )
  }, [settled, settings.timeZone, device, accountId, owner, mutate])
}

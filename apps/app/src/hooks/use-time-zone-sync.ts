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
 * the session account's own, and each write names that account, so the API refuses it once the cookie is another's. A failed
 * write is not sent again for the same account and zone until the next launch or sign-in. Mounted once, in the root layout.
 * @example useTimeZoneSync()
 */
export function useTimeZoneSync(): void {
  const { settings, ready, owner } = useSettings()
  const device = useDeviceZone()
  const { data: session } = authClient.useSession()
  const accountId = session?.user.id
  const { mutate, reset, isError, variables } = useUpdateSettings()
  const writing = useIsMutating({ mutationKey: orpc.settings.key() }) > 0
  // A sign-in (the same account after an expired cookie, or back from another) is a fresh start: a write that failed before it
  // may succeed now. Declared before the sync so it clears the failure first.
  useEffect(() => reset(), [accountId, reset])
  // Without an account id (an expired session, a sign-out from another tab) the device's store cannot be read, and a write
  // would only fail.
  const settled = ready && !writing && Boolean(accountId)
  // The failed write's own variables break the loop a rollback would otherwise start (the old zone is back in the cache, so
  // write it again), for that account and zone only.
  const failedWrite = isError ? variables : undefined
  useEffect(() => {
    const action = zoneSyncAction({
      stored: settings.timeZone,
      device,
      lastSynced: readSyncedZone(accountId),
      settled,
      failedWrite,
      account: accountId,
      rowAccount: owner,
    })
    if (action === 'record') rememberSyncedZone(accountId, device)
    if (action === 'write')
      mutate(
        { timeZone: device, forUserId: accountId },
        // The row the API wrote says whose it was: the session may have turned to another account while the write was out.
        { onSuccess: (row) => rememberSyncedZone(row.userId, device) },
      )
  }, [
    settled,
    settings.timeZone,
    device,
    accountId,
    owner,
    failedWrite,
    mutate,
  ])
}

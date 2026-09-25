import { useIsMutating } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useDeviceZone } from '@/hooks/use-device-zone'
import { useSettings, useUpdateSettings } from '@/hooks/use-settings'
import { authClient } from '@/lib/auth-client'
import { rememberSyncedZone } from '@/lib/device-zone'
import { orpc } from '@/lib/orpc'
import { zoneRow, type ZoneRow } from '@/lib/settings'

/**
 * 設定's タイムゾーン row: the account's zone next to this device's ({@link zoneRow}), and the take-back that writes this device's
 * zone over one another device set. The take-back is remembered as this device's sync, so {@link useTimeZoneSync} leaves it be.
 * Its failure line lasts until the next tap or the next account. Read by {@link TimeZoneRow}.
 * @example const { summary, canTakeBack, busy, takeBack } = useAccountZone()
 */
export function useAccountZone(): ZoneRow & {
  busy: boolean
  takeBack: () => void
} {
  const { settings, ready } = useSettings()
  const device = useDeviceZone()
  const { data: session } = authClient.useSession()
  const accountId = session?.user.id
  const { mutate, isError, reset } = useUpdateSettings()
  // Any settings write in flight (a theme tap, the automatic sync) holds the button: the scope would queue the take-back behind it.
  const busy = useIsMutating({ mutationKey: orpc.settings.key() }) > 0
  useEffect(() => reset(), [accountId, reset])
  return {
    ...zoneRow({
      stored: settings.timeZone,
      device,
      ready,
      failed: isError,
    }),
    busy,
    takeBack: (): void =>
      mutate(
        { timeZone: device },
        { onSuccess: () => rememberSyncedZone(accountId, device) },
      ),
  }
}

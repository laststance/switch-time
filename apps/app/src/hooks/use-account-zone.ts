import { useIsMutating } from '@tanstack/react-query'

import { useDeviceZone } from '@/hooks/use-device-zone'
import { useSettings, useUpdateSettings } from '@/hooks/use-settings'
import { authClient } from '@/lib/auth-client'
import { rememberSyncedZone } from '@/lib/device-zone'
import { orpc } from '@/lib/orpc'
import { zoneRow, type ZoneRow } from '@/lib/settings'

/**
 * 設定's タイムゾーン row: the account's zone next to this device's ({@link zoneRow}), and the take-back that writes this device's
 * zone over one another device set. The take-back names the account it was tapped for, so the API refuses it once the cookie
 * is another's, and it is remembered as this device's sync, so {@link useTimeZoneSync} leaves it be. Its failure line lasts
 * until the next tap, and shows only for the account and zone it failed for. Read by {@link TimeZoneRow}.
 * @example const { summary, canTakeBack, busy, takeBack } = useAccountZone()
 */
export function useAccountZone(): ZoneRow & {
  busy: boolean
  takeBack: () => void
} {
  const { settings, ready, owner } = useSettings()
  const device = useDeviceZone()
  const { data: session } = authClient.useSession()
  const accountId = session?.user.id
  const { mutate, isError, variables } = useUpdateSettings()
  // Any settings write in flight (a theme tap, the automatic sync) holds the button: the scope would queue the take-back behind it.
  const busy = useIsMutating({ mutationKey: orpc.settings.key() }) > 0
  return {
    ...zoneRow({
      stored: settings.timeZone,
      device,
      ready,
      failedWrite: isError ? variables : undefined,
      account: accountId,
      rowAccount: owner,
    }),
    busy,
    takeBack: (): void =>
      mutate(
        { timeZone: device, forUserId: accountId },
        { onSuccess: (row) => rememberSyncedZone(row.userId, device) },
      ),
  }
}

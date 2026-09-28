import { settingsUpdateSchema } from '@switch-time/shared'
import { useIsMutating, useMutationState } from '@tanstack/react-query'

import { useDeviceZone } from '@/hooks/use-device-zone'
import { useSettings, useUpdateSettings } from '@/hooks/use-settings'
import { authClient } from '@/lib/auth-client'
import { orpc } from '@/lib/orpc'
import { type FailedZoneWrite, zoneRow, type ZoneRow } from '@/lib/settings'

/**
 * 設定's タイムゾーン row: the account's zone next to this device's ({@link zoneRow}), and the take-back that writes this device's
 * zone over one another device set. The take-back names the account it was tapped for, so the API refuses it once the cookie
 * is another's, and {@link useUpdateSettings} remembers it as this device's sync, so {@link useTimeZoneSync} leaves it be. The
 * failure line follows the last zone written by hand, here or on the タイムゾーン sheet ({@link useFailedZoneWrite}), for the
 * account and zone it failed for. Read by {@link TimeZoneRow}.
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
  const { mutate } = useUpdateSettings()
  const failedWrite = useFailedZoneWrite()
  // Any settings write in flight (a theme tap, the automatic sync) holds the button: the scope would queue the take-back behind it.
  const busy = useIsMutating({ mutationKey: orpc.settings.key() }) > 0
  return {
    ...zoneRow({
      stored: settings.timeZone,
      device,
      ready,
      failedWrite,
      account: accountId,
      rowAccount: owner,
    }),
    busy,
    takeBack: (): void => mutate({ timeZone: device, forUserId: accountId }),
  }
}

/**
 * The last zone write made by hand (the take-back, a pick on the タイムゾーン sheet), when it failed: read from the mutation
 * cache rather than one screen's mutation, so a pick that fails after the sheet has closed still reaches 設定's row. The
 * automatic sync's writes are left out ({@link useUpdateSettings}' `automatic`), and so is every write without a zone.
 * @returns The failed write's account and zone, or undefined when the last one landed, is in flight, or there was none.
 * @example const failedWrite = useFailedZoneWrite() // { forUserId: 'u1', timeZone: 'America/New_York' }
 */
function useFailedZoneWrite(): FailedZoneWrite {
  const writes = useMutationState({
    filters: {
      mutationKey: orpc.settings.update.mutationKey(),
      predicate: (mutation) => mutation.meta?.automatic !== true,
    },
    select: (mutation) => ({
      status: mutation.state.status,
      input: settingsUpdateSchema.safeParse(mutation.state.variables).data,
    }),
  })
  // Mutations are listed oldest first; only the latest one that carried a zone decides.
  const last = writes
    .filter((write) => write.input?.timeZone !== undefined)
    .at(-1)
  return last?.status === 'error' ? last.input : undefined
}

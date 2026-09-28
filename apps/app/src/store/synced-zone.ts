import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { z } from 'zod'

// What a device may hold under the store's key: anything else there (hand-edited, another build's shape) is not trusted.
const syncedZoneStateSchema = z.object({
  byAccount: z.record(z.string(), z.string()),
})

type SyncedZoneState = z.infer<typeof syncedZoneStateSchema>

const initialState: SyncedZoneState = { byAccount: {} }

/**
 * The zone this device last wrote (or found) in each account's settings, one entry per account, so a second account signed
 * in on this device still gets its zone written once. The store persists it on the device ({@link store}), and keeps it
 * through {@link resetApp}: a sign-out must not make the next sign-in look like a fresh install. Where storage fails (a
 * private window, a locked keychain) the store's copy still holds until the app restarts. Read by {@link useTimeZoneSync},
 * written by it and by {@link useAccountZone}'s take-back.
 * @example dispatch(zoneSynced({ accountId: session?.user.id, zone: 'Asia/Tokyo' }))
 */
export const syncedZoneSlice = createSlice({
  name: 'syncedZone',
  initialState,
  reducers: {
    zoneSynced(
      state,
      action: PayloadAction<{ accountId: string | undefined; zone: string }>,
    ) {
      const { accountId, zone } = action.payload
      // Signed out: nothing is kept, so the next account to sign in starts unsynced.
      if (accountId) state.byAccount[accountId] = zone
    },
  },
  selectors: {
    /**
     * @param accountId - The signed-in account, undefined while signed out.
     * @returns The zone, or null when this device never synced the account.
     */
    selectSyncedZone: (state, accountId: string | undefined): string | null =>
      // Own entries only: an id such as `constructor` must not read what every object inherits.
      accountId && Object.hasOwn(state.byAccount, accountId)
        ? (state.byAccount[accountId] ?? null)
        : null,
  },
})

export const { zoneSynced } = syncedZoneSlice.actions
export const { selectSyncedZone } = syncedZoneSlice.selectors

/**
 * The synced zones the store takes back from the device at launch, checked first: the storage middleware would otherwise put
 * whatever the key holds into state, and one broken value would throw on every render, launch after launch. Passed as the
 * storage middleware's `merge` by {@link createAppStore}.
 * @param persisted - The `syncedZone` read from the device, of any shape.
 * @param current - The slice as it stands before the read.
 * @returns
 * - a well-formed value: the zones the device kept
 * - anything else: `current`, so each account syncs its zone once more
 * @example restoreSyncedZone({ byAccount: { u1: 'Asia/Tokyo' } }, { byAccount: {} }) // { byAccount: { u1: 'Asia/Tokyo' } }
 * @example restoreSyncedZone(null, { byAccount: {} }) // { byAccount: {} }
 */
export function restoreSyncedZone(
  persisted: unknown,
  current: SyncedZoneState,
): SyncedZoneState {
  const parsed = syncedZoneStateSchema.safeParse(persisted)
  return parsed.success ? parsed.data : current
}

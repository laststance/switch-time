import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

const initialState: { byAccount: Record<string, string> } = { byAccount: {} }

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
      accountId ? (state.byAccount[accountId] ?? null) : null,
  },
})

export const { zoneSynced } = syncedZoneSlice.actions
export const { selectSyncedZone } = syncedZoneSlice.selectors

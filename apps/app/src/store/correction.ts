import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'

import type { UndoSlot } from '@/lib/correction'

type CorrectionSliceState = {
  /** Drawn afresh whenever the slice starts over ({@link resetApp} on sign-out, or a new account): an action from an older epoch is ignored. */
  epoch: string
  /** The armed 「元に戻す」 per day (`YYYY-MM-DD`), absent when that day has none. */
  undo: Partial<Record<string, UndoSlot>>
  /** The user id the slots were armed under: the last one {@link AppLayout} reported (`null` before it, and after {@link resetApp}). */
  account: string | null
}

/**
 * The correction sheet's 「元に戻す」, kept outside the sheet so an edit that lands after the sheet closed still arms it,
 * and a reopened sheet for that day offers it. {@link useCorrection} dispatches from each edit's and undo's answer, with the
 * `epoch` it read at the press: a write still in flight at sign-out cannot arm, or drop, the next account's undo.
 * @example dispatch(correctionSlice.actions.armed({ epoch, slot }))
 */
export const correctionSlice = createSlice({
  name: 'correction',
  // Lazy, so every start over (a reset passes `undefined` state) draws a new epoch.
  initialState: (): CorrectionSliceState => ({
    epoch: nanoid(),
    undo: {},
    account: null,
  }),
  reducers: {
    // Another tab can sign out and in as someone else without this tab's sign-in or sign-out running: the cookie is shared, so
    // a slot armed under the old account would write its snapshot into the new one's day. A new account starts over, epoch
    // included; the same account coming back (a session refetch) keeps its slots.
    accountSeen(state, action: PayloadAction<string>) {
      if (action.payload === state.account) return
      return { epoch: nanoid(), undo: {}, account: action.payload }
    },
    armed(state, action: PayloadAction<{ epoch: string; slot: UndoSlot }>) {
      if (action.payload.epoch !== state.epoch) return
      state.undo[action.payload.slot.day] = action.payload.slot
    },
    dropped(state, action: PayloadAction<{ epoch: string; day: string }>) {
      if (action.payload.epoch !== state.epoch) return
      delete state.undo[action.payload.day]
    },
  },
})

/**
 * What {@link useAccountScope} does when the session reports `account`: another tab can sign in as someone else, and this
 * tab's session turns to them on focus without this tab's sign-in or sign-out running.
 * @param seen - The account the store's undo slots belong to (`null` before the first one, and after {@link resetApp}).
 * @param account - The session's user id, undefined while there is no session.
 * @returns
 * - `null`: nothing to do (no session, or the same account)
 * - `{ account, switched: false }`: the first account since the store started over, whose slots start empty anyway
 * - `{ account, switched: true }`: someone else: the cached queries go as well as the slots
 * @example
 * accountChange(null, 'user-a')     // => { account: 'user-a', switched: false }
 * accountChange('user-a', 'user-b') // => { account: 'user-b', switched: true }
 * accountChange('user-a', undefined) // => null
 */
export function accountChange(
  seen: string | null,
  account: string | undefined,
): { account: string; switched: boolean } | null {
  if (!account || account === seen) return null
  return { account, switched: seen !== null }
}

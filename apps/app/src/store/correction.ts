import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'

import type { UndoSlot } from '@/lib/correction'

type CorrectionSliceState = {
  /** Drawn afresh whenever the slice starts over ({@link resetApp} on sign-out, or a new account): an action from an older epoch is ignored. */
  epoch: string
  /** The armed 「元に戻す」 per day (`YYYY-MM-DD`), absent when that day has none. */
  undo: Partial<Record<string, UndoSlot>>
  /** Why the last edit or undo pressed on each day failed ({@link refusalMessage}), until the next press, selection or undo there. */
  refusal: Partial<Record<string, string>>
  /** The row each day's archived notice was raised for ({@link archivedBox}), until the next press or selection there. */
  notice: Partial<Record<string, string>>
  /** The user id the slots were armed under: the last one {@link AppLayout} reported (`null` before it, and after {@link resetApp}). */
  account: string | null
}

type Stamped<Payload> = PayloadAction<Payload & { epoch: string }>

/**
 * What the correction sheet keeps about each day outside the sheet itself: the armed 「元に戻す」, the last failure's line and
 * the archived notice. An edit, or an undo, that lands after the sheet closed still arms the slot or says why it failed, and a
 * reopened sheet for that day offers or shows it. {@link useCorrection} dispatches from each press's answer, with the `epoch`
 * it read at the press: a write still in flight at sign-out cannot arm, drop or say anything in the next account.
 * @example dispatch(correctionSlice.actions.armed({ epoch, slot }))
 */
export const correctionSlice = createSlice({
  name: 'correction',
  // Lazy, so every start over (a reset passes `undefined` state) draws a new epoch.
  initialState: (): CorrectionSliceState => ({
    epoch: nanoid(),
    undo: {},
    refusal: {},
    notice: {},
    account: null,
  }),
  reducers: {
    // Another tab can sign out and in as someone else without this tab's sign-in or sign-out running: the cookie is shared, so
    // a slot armed under the old account would write its snapshot into the new one's day. A new account starts over, epoch
    // included; the same account coming back (a session refetch) keeps its slots.
    accountSeen(state, action: PayloadAction<string>) {
      if (action.payload === state.account) return
      return {
        epoch: nanoid(),
        undo: {},
        refusal: {},
        notice: {},
        account: action.payload,
      }
    },
    armed(state, action: Stamped<{ slot: UndoSlot }>) {
      if (action.payload.epoch !== state.epoch) return
      state.undo[action.payload.slot.day] = action.payload.slot
    },
    dropped(state, action: Stamped<{ day: string }>) {
      if (action.payload.epoch !== state.epoch) return
      delete state.undo[action.payload.day]
    },
    // A failed edit or undo: the day's status line says why, whether or not its sheet is still open.
    refused(state, action: Stamped<{ day: string; text: string }>) {
      if (action.payload.epoch !== state.epoch) return
      state.refusal[action.payload.day] = action.payload.text
    },
    // An archived pick, or an undo refused as archived: the row's panel shows the notice, on this day only.
    noticed(state, action: Stamped<{ day: string; id: string }>) {
      if (action.payload.epoch !== state.epoch) return
      state.notice[action.payload.day] = action.payload.id
    },
    // A new press or a selection on the day: what the line said was about another moment. An undo keeps the notice, since
    // it may be the undo the notice is about.
    hushed(state, action: Stamped<{ day: string; notice: boolean }>) {
      if (action.payload.epoch !== state.epoch) return
      delete state.refusal[action.payload.day]
      if (action.payload.notice) delete state.notice[action.payload.day]
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

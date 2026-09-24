import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'

import type { UndoSlot } from '@/lib/correction'

type CorrectionState = {
  /** Drawn afresh whenever the slice starts over ({@link resetApp} on sign-out): an action from an older epoch is ignored. */
  epoch: string
  /** The armed 「元に戻す」 per day (`YYYY-MM-DD`), absent when that day has none. */
  undo: Partial<Record<string, UndoSlot>>
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
  initialState: (): CorrectionState => ({ epoch: nanoid(), undo: {} }),
  reducers: {
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

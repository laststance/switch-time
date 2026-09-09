import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/**
 * Transient UI state shared across screens: the open bottom sheet and the day the history view shows.
 * @example dispatch(uiSlice.actions.openSheet('correction'))
 */
export const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    sheet: null as 'correction' | null,
    selectedDay: null as string | null,
  },
  reducers: {
    openSheet(state, action: PayloadAction<'correction'>) {
      state.sheet = action.payload
    },
    closeSheet(state) {
      state.sheet = null
    },
    selectDay(state, action: PayloadAction<string | null>) {
      state.selectedDay = action.payload
    },
  },
})

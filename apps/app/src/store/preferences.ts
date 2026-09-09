import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { ThemeMode } from '@switch-time/shared'

/**
 * Client mirror of the user's preferences, only what the UI needs to resolve locally (server truth stays in TanStack Query).
 * @example dispatch(preferencesSlice.actions.setTheme('dark'))
 */
export const preferencesSlice = createSlice({
  name: 'preferences',
  initialState: { theme: 'auto' as ThemeMode, showSecondHand: true },
  reducers: {
    setTheme(state, action: PayloadAction<ThemeMode>) {
      state.theme = action.payload
    },
    setShowSecondHand(state, action: PayloadAction<boolean>) {
      state.showSecondHand = action.payload
    },
  },
})

/**
 * Maps a {@link ThemeMode} to the concrete Uniwind theme: `auto` is light from 06:00 to 17:59 local time, dark otherwise ({@link useThemeSync}).
 * @example resolveTheme('auto', new Date(2026, 8, 9, 6, 0)) // 'light'
 */
export function resolveTheme(mode: ThemeMode, now: Date): 'light' | 'dark' {
  if (mode !== 'auto') return mode
  const hour = now.getHours()
  return hour >= 6 && hour < 18 ? 'light' : 'dark'
}

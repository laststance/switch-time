import type { ThemeMode } from '@switch-time/shared'

/**
 * Maps a {@link ThemeMode} to the concrete Uniwind theme: `auto` is light from 06:00 to 17:59 local time, dark otherwise ({@link useThemeSync}).
 * @example resolveTheme('auto', new Date(2026, 8, 9, 6, 0)) // 'light'
 */
export function resolveTheme(mode: ThemeMode, now: Date): 'light' | 'dark' {
  if (mode !== 'auto') return mode
  const hour = now.getHours()
  return hour >= 6 && hour < 18 ? 'light' : 'dark'
}

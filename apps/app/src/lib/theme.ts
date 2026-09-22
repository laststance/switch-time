import type { ThemeMode } from '@switch-time/shared'

/** The design `bg` tokens: Safari's URL bar and toolbar read these via `theme-color` / `color-scheme`. */
export const THEME_BG = {
  light: '#f5f2eb',
  dark: '#111216',
} as const

/**
 * Maps a {@link ThemeMode} to the concrete Uniwind theme: `auto` is light from 06:00 to 17:59 local time, dark otherwise ({@link useThemeSync}).
 * @example resolveTheme('auto', new Date(2026, 8, 9, 6, 0)) // 'light'
 */
export function resolveTheme(mode: ThemeMode, now: Date): 'light' | 'dark' {
  if (mode !== 'auto') return mode
  const hour = now.getHours()
  return hour >= 6 && hour < 18 ? 'light' : 'dark'
}

/**
 * Tints the browser chrome to the resolved `bg` so a dark Home is not framed by paper-white Safari bars; no-ops off web.
 * @example paintBrowserChrome('dark')
 */
export function paintBrowserChrome(theme: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.colorScheme = theme
  // First paint uses OS media metas; once the resolved band is known they would fight 明／暗.
  for (const el of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"][media]',
  )) {
    el.media = 'not all'
  }
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]:not([media])',
  )
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', THEME_BG[theme])
}

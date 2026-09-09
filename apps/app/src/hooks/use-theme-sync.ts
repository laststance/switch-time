import { useEffect } from 'react'
import { Uniwind } from 'uniwind'

import { useSettings } from '@/hooks/use-settings'
import { resolveTheme } from '@/lib/theme'
import { useAppSelector } from '@/store'

/**
 * Pushes the {@link resolveTheme} result into Uniwind whenever the stored theme or the clock crosses a band boundary; `auto` until the settings row has loaded and while signed out.
 * @example useThemeSync()
 */
export function useThemeSync() {
  const mode = useSettings().settings.theme
  // Selecting the resolved string means the per-second clock tick re-renders nothing until the band flips.
  const theme = useAppSelector((s) => resolveTheme(mode, new Date(s.clock.now)))
  useEffect(() => {
    Uniwind.setTheme(theme)
  }, [theme])
}

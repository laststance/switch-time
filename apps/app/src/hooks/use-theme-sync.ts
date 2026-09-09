import { useEffect } from 'react'
import { Uniwind } from 'uniwind'

import { useAppSelector } from '@/store'
import { resolveTheme } from '@/store/preferences'

/**
 * Pushes the {@link resolveTheme} result into Uniwind whenever the preference or the clock crosses a band boundary.
 * @example useThemeSync()
 */
export function useThemeSync() {
  // Selecting the resolved string means the per-second clock tick re-renders nothing until the band flips.
  const theme = useAppSelector((s) =>
    resolveTheme(s.preferences.theme, new Date(s.clock.now)),
  )
  useEffect(() => {
    Uniwind.setTheme(theme)
  }, [theme])
}

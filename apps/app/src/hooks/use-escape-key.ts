import { useEffect } from 'react'
import { Platform } from 'react-native'

/**
 * Calls `onEscape` on the Escape key while the component is mounted; web only, native modals have the swipe.
 * @example useEscapeKey(dismiss)
 */
export function useEscapeKey(onEscape: () => void) {
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape])
}

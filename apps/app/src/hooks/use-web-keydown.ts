import { useEffect, useEffectEvent } from 'react'
import { Platform } from 'react-native'

/**
 * Runs `handler` for every keydown on the window while the component is mounted; web only, native has no keyboard chrome.
 * The handler always sees the latest render (Escape on sheets, the digit hotkeys on Home) without re-subscribing.
 * @example useWebKeydown((event) => { if (event.key === 'Escape') dismiss() })
 */
export function useWebKeydown(handler: (event: KeyboardEvent) => void) {
  const onKeydown = useEffectEvent(handler)
  useEffect(() => {
    if (Platform.OS !== 'web') return
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [])
}

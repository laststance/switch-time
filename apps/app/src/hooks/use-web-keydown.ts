import { useEffect, useEffectEvent } from 'react'
import { Platform } from 'react-native'

/**
 * Runs `handler` for every keydown on the window while the component is mounted; web only, native has no keyboard chrome.
 * The handler always sees the latest render (Escape on sheets, the digit hotkeys on Home) without re-subscribing.
 * @param options.capture - Hear the key before the focused element does: react-native-web's TextInput stops every keydown
 *   from bubbling, so a sheet with a search field would otherwise miss Escape and Tab pressed in it.
 * @example useWebKeydown((event) => { if (event.key === 'Escape') dismiss() }, { capture: true })
 */
export function useWebKeydown(
  handler: (event: KeyboardEvent) => void,
  { capture = false }: { capture?: boolean } = {},
): void {
  const onKeydown = useEffectEvent(handler)
  useEffect(() => {
    if (Platform.OS !== 'web') return
    window.addEventListener('keydown', onKeydown, { capture })
    return (): void =>
      window.removeEventListener('keydown', onKeydown, { capture })
  }, [capture])
}

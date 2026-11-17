import { useEffect, useLayoutEffect, useRef, type ComponentRef } from 'react'
import { Platform, type View } from 'react-native'

// Focus belongs to the browser document; this ephemeral DOM reference never enters application state.
let lastFocused: Element | null = null

/**
 * Remembers web focus before a route makes its underlying screen inert.
 *
 * {@link AppLayout} calls this once across sheet navigation so {@link useInitialFocus}
 * can restore the opener even after the browser blurs it. Native modals manage their own focus.
 *
 * @example
 * ```tsx
 * useRememberFocus() // In the authenticated layout above the sheet routes.
 * ```
 */
export function useRememberFocus(): void {
  useEffect(() => {
    if (Platform.OS !== 'web') return
    lastFocused = document.activeElement
    const rememberFocus = (event: FocusEvent): void => {
      // Becoming inert blurs the opener to body; preserve the last actual control.
      if (event.target instanceof Element && event.target !== document.body) {
        lastFocused = event.target
      }
    }
    document.addEventListener('focusin', rememberFocus)
    return (): void => {
      document.removeEventListener('focusin', rememberFocus)
      lastFocused = null
    }
  }, [])
}

/**
 * Ref for the element that takes keyboard focus once mounted: web only, where a dialog otherwise leaves focus on the screen
 * underneath; native modals manage focus themselves. On unmount focus goes back to the element that had it before (the row
 * that opened the sheet), so a keyboard user carries on where they were.
 * @example const dialogRef = useInitialFocus() // <View ref={dialogRef} tabIndex={-1} role="dialog" />
 */
export function useInitialFocus() {
  const ref = useRef<ComponentRef<typeof View>>(null)
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return
    // Expo's Stack may already have made the opener inert before this sheet mounts.
    const opener =
      document.activeElement === document.body
        ? lastFocused
        : document.activeElement
    ref.current?.focus()
    return (): void => {
      // The opener may be gone (a sign-out redirect, a route replaced by URL); focusing a detached node would do nothing useful.
      // Stack dismissal removes the previous screen’s inert state after effect cleanup.
      requestAnimationFrame(() => {
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
      })
    }
  }, [])
  return ref
}

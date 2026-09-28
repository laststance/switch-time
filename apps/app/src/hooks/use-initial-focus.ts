import { useEffect, useRef } from 'react'
import { Platform, type View } from 'react-native'

/**
 * Ref for the element that takes keyboard focus once mounted: web only, where a dialog otherwise leaves focus on the screen
 * underneath; native modals manage focus themselves. On unmount focus goes back to the element that had it before (the row
 * that opened the sheet), so a keyboard user carries on where they were.
 * @example const dialogRef = useInitialFocus() // <View ref={dialogRef} tabIndex={-1} role="dialog" />
 */
export function useInitialFocus() {
  const ref = useRef<View>(null)
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const opener = document.activeElement
    ref.current?.focus()
    return (): void => {
      // The opener may be gone (a sign-out redirect, a route replaced by URL); focusing a detached node would do nothing useful.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  return ref
}

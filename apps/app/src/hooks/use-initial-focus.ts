import { useEffect, useRef } from 'react'
import { Platform, type View } from 'react-native'

/**
 * Ref for the element that takes keyboard focus once mounted: web only, where a dialog otherwise leaves focus on the screen underneath; native modals manage focus themselves.
 * @example const dialogRef = useInitialFocus() // <View ref={dialogRef} tabIndex={-1} role="dialog" />
 */
export function useInitialFocus() {
  const ref = useRef<View>(null)
  useEffect(() => {
    if (Platform.OS === 'web') ref.current?.focus()
  }, [])
  return ref
}

import { useFocusEffect } from 'expo-router'
import { useCallback, useRef } from 'react'
import type { TextInput } from 'react-native'

/**
 * Ref for a field that takes the focus the first time its screen comes into view, while `enabled`: sign-in's password after 登録.
 * `autoFocus` alone misses sign-up reached through 新規登録はこちら, where the sign-in form remounts hidden underneath and only
 * then comes back into view. Once per mount: a later return (back from sign-up without registering) leaves the focus alone.
 * @param enabled - Whether the field takes the focus (sign-in: an address was carried over from sign-up).
 * @example const passwordRef = useScreenFocusField(start.focusPassword) // <CredentialFields passwordRef={passwordRef} … />
 */
export function useScreenFocusField(enabled: boolean) {
  const ref = useRef<TextInput>(null)
  const focused = useRef(false)
  useFocusEffect(
    useCallback(() => {
      // Skip when not asked for, or when this mount already moved the focus once.
      if (!enabled || focused.current) return
      focused.current = true
      ref.current?.focus()
    }, [enabled]),
  )
  return ref
}

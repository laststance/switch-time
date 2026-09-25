import { useGlobalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'

import { useAppDispatch, useAppSelector } from '@/store'
import { registrationSlice } from '@/store/registration'

/**
 * The registration sign-up hands to sign-in ({@link registrationSlice}): sign-up calls `register` once Better Auth answers,
 * sign-in reads `registration` (prefill, notice) and calls `dismissNotice` on the first keystroke or submit.
 * @returns
 * - `registration`: the address just registered and whether its notice shows, or `null`
 * - `register(email)`: records it and goes back to sign-in (keeping `next`), unless the user already left sign-up
 * - `dismissNotice()`: hides the notice, keeping the address
 * @example const { registration, dismissNotice } = useRegistration()
 */
export function useRegistration() {
  const registration = useAppSelector((state) => state.registration.current)
  const dispatch = useAppDispatch()
  const router = useRouter()
  const navigation = useNavigation()
  const { next } = useGlobalSearchParams<{ next?: string | string[] }>()

  const register = (email: string): void => {
    // Left while the request ran (a link keeps sign-up mounted underneath, going back removes it): moving on would replace the form now in front.
    if (!navigation.isFocused()) return
    dispatch(registrationSlice.actions.registered(email))
    // Back to the sign-in screen underneath when there is one, else in place of sign-up: the filled form is not left behind.
    router.dismissTo({
      pathname: '/sign-in',
      params: typeof next === 'string' ? { next } : {},
    })
  }
  const dismissNotice = (): void => {
    if (registration?.notice)
      dispatch(registrationSlice.actions.noticeDismissed())
  }
  return { registration, register, dismissNotice }
}

/**
 * Says `text` once through the native screen reader when it appears; on web it does nothing (react-native-web's
 * announceForAccessibility is a no-op), where the field it describes carries it through aria-describedby instead. Android is
 * included, unlike the correction sheet's iOS-only readout: a live region is read when its text changes, and this notice is already
 * there when sign-in mounts.
 * @example useNativeAnnouncement(notice) // notice: '登録しました…' | null
 */
export function useNativeAnnouncement(text: string | null): void {
  useEffect(() => {
    if (text && Platform.OS !== 'web')
      AccessibilityInfo.announceForAccessibility(text)
  }, [text])
}

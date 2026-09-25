import type { Registration } from '@/store/registration'

// The same words whether the address was new or already had an account: that is what keeps sign-up from telling.
const REGISTERED_NOTICE = '登録しました。サインインしてください'

/** How the sign-in form starts: its remount key, the prefilled address, the notice line and whether the password takes the focus. */
export type SignInStart = {
  key: string
  email: string
  notice: typeof REGISTERED_NOTICE | null
  focusPassword: boolean
}

/**
 * Derives sign-in's starting state from the registration sign-up handed over ({@link registrationSlice}); read by the sign-in screen.
 * @param registration - The address just registered on this device, or `null` when the user came to sign in directly.
 * @returns
 * - no registration: a blank form, no notice, no forced focus
 * - a registration: its address filled in, the password focused, and the notice until it is dismissed
 * @example signInStart(null) // => { key: 'blank', email: '', notice: null, focusPassword: false }
 * @example signInStart({ id: 'r1', email: 'a@example.com', notice: true }) // => { key: 'r1', email: 'a@example.com', notice: '登録しました。…', focusPassword: true }
 */
export function signInStart(registration: Registration | null): SignInStart {
  if (!registration)
    return { key: 'blank', email: '', notice: null, focusPassword: false }
  return {
    key: registration.id,
    email: registration.email,
    notice: registration.notice ? REGISTERED_NOTICE : null,
    focusPassword: true,
  }
}

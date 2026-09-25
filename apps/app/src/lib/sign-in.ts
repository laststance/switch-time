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

/**
 * The key sign-in's form keeps: a new registration replaces it, losing one does not. Sign-in's own success resets the store (and
 * with it the registration) while the session is still loading, and a blank key would empty the form the user just sent.
 * @param current - The key the form has now.
 * @param next - The key {@link signInStart} derives from the current registration ('blank' when there is none).
 * @returns `next` for a registration, else `current`
 * @example keptFormKey('r1', 'blank') // => 'r1'
 * @example keptFormKey('blank', 'r2') // => 'r2'
 */
export function keptFormKey(current: string, next: string): string {
  return next === 'blank' ? current : next
}

/**
 * Whether sign-in's button waits: while the request runs, and after it went through until the session lands (the (auth) layout
 * then leaves sign-in). A second tap in between would open a second session and spend the sign-in rate limit.
 * @param request - The form's request: running, or through.
 * @param session - Better Auth's session query: `pending` while it has no answer, `reloadStarted` once it has begun the reload
 * that follows a sign-in that went through (Better Auth starts it a moment after the request answers).
 * @returns
 * - true while the request runs, and once it went through until the session reload has started and answered
 * - false otherwise, so a sign-in whose session never loads can be sent again
 * @example signInBusy({ pending: false, succeeded: true }, { pending: false, reloadStarted: false }) // => true
 */
export function signInBusy(
  request: { pending: boolean; succeeded: boolean },
  session: { pending: boolean; reloadStarted: boolean },
): boolean {
  return (
    request.pending ||
    (request.succeeded && (!session.reloadStarted || session.pending))
  )
}

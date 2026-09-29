import type { Registration } from '@/store/registration'

// The same words whether the address was new or already had an account: that is what keeps sign-up from telling.
const REGISTERED_NOTICE = '登録しました。サインインしてください'

// With a mail server the account cannot sign in until the link in the mail is opened (pen board 「ST Phone / メール確認とパスワード再設定」).
const CONFIRM_BY_MAIL_NOTICE =
  '登録しました。確認メールのリンクを開いてから、サインインしてください'
const VERIFIED_NOTICE = 'メールアドレスを確認しました。サインインしてください'
const RESET_NOTICE =
  'パスワードを変えました。新しいパスワードでサインインしてください'
const LINK_EXPIRED_ERROR =
  'リンクの期限が切れています。サインインすると、確認メールをもう一度お送りします'

/** How a mailed link or a finished reset sent the user back to sign-in: what its query says. */
export type SignInArrival = 'verified' | 'reset' | 'link-failed'

/**
 * Reads how the user came to sign-in from its query: the confirmation link ends at `?verified=1` (or `?error=…` when it is used up),
 * and a finished password reset moves on to `?reset=1`. Read by the sign-in screen for {@link signInStart}.
 * @param params - The screen's search params (each may be an array when repeated).
 * @returns
 * - an `error` param: `'link-failed'`, ahead of the others, since it says nothing was confirmed
 * - `verified=1`: `'verified'`; `reset=1`: `'reset'`
 * - none of them: `null`
 * @example signInArrival({ verified: '1' }) // => 'verified'
 * @example signInArrival({ error: 'invalid_token' }) // => 'link-failed'
 */
export function signInArrival(params: {
  verified?: string | string[]
  reset?: string | string[]
  error?: string | string[]
}): SignInArrival | null {
  if (params.error) return 'link-failed'
  if (params.verified === '1') return 'verified'
  if (params.reset === '1') return 'reset'
  return null
}

const ARRIVAL_NOTICE = {
  verified: VERIFIED_NOTICE,
  reset: RESET_NOTICE,
  'link-failed': null,
} as const satisfies Record<SignInArrival, string | null>

/** How the sign-in form starts: its remount key, the prefilled address, the notice and error lines, and whether the password takes the focus. */
export type SignInStart = {
  key: string
  email: string
  notice: string | null
  // Only for an arrival by a confirmation link that no longer works; a failed try shows its own error in the same box.
  error: string | null
  focusPassword: boolean
}

/**
 * Derives sign-in's starting state from the registration sign-up handed over ({@link registrationSlice}) or from the link the
 * user came by ({@link signInArrival}); read by the sign-in screen.
 * @param registration - The address just registered on this device, or `null` when the user came to sign in directly.
 * @param arrival - How a mailed link or a finished reset brought the user here, or `null`.
 * @returns
 * - a registration: its address filled in, the password focused, and its notice until dismissed (the one that says to open the mailed link when a mail went out)
 * - an arrival with no registration: a blank form with the notice (or, for a link that failed, the error)
 * - neither: a blank form, no notice, no forced focus
 * @example signInStart(null, null) // => { key: 'blank', email: '', notice: null, error: null, focusPassword: false }
 * @example signInStart({ id: 'r1', email: 'a@example.com', confirmByMail: false, notice: true }, null) // => { key: 'r1', email: 'a@example.com', notice: '登録しました。…', error: null, focusPassword: true }
 * @example signInStart(null, 'verified').notice // => 'メールアドレスを確認しました。サインインしてください'
 */
export function signInStart(
  registration: Registration | null,
  arrival: SignInArrival | null,
): SignInStart {
  if (registration) {
    const registeredNotice = registration.confirmByMail
      ? CONFIRM_BY_MAIL_NOTICE
      : REGISTERED_NOTICE
    return {
      key: registration.id,
      email: registration.email,
      notice: registration.notice ? registeredNotice : null,
      error: null,
      focusPassword: true,
    }
  }
  return {
    key: 'blank',
    email: '',
    notice: arrival ? ARRIVAL_NOTICE[arrival] : null,
    error: arrival === 'link-failed' ? LINK_EXPIRED_ERROR : null,
    focusPassword: false,
  }
}

/**
 * The line in sign-in's alert box: the answer to the last try, else the error the arrival came with (a used-up confirmation link).
 * @param serverError - {@link useAuthForm}'s `serverError`, or `null`.
 * @param start - The form's {@link SignInStart}.
 * @returns The error line, or `null` for none.
 * @example signInError(null, signInStart(null, 'link-failed')) // => 'リンクの期限が切れています。…'
 * @example signInError('もう一度お試しください', signInStart(null, 'link-failed')) // => 'もう一度お試しください'
 */
export function signInError(
  serverError: string | null,
  start: SignInStart,
): string | null {
  return serverError ?? start.error
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

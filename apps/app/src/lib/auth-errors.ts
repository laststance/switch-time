import { AUTH_FIELD_MESSAGE } from '@switch-time/shared'

/** What Better Auth's client returns as `error` (better-fetch's shape, all of it optional here: a transport failure has none of it). */
export type AuthError = { code?: string; status?: number; message?: string }

// The words for a sign-in or sign-up that could not go through, from the pen board 「ST Phone / サインイン・入力中と失敗」.
const RETRY = 'もう一度お試しください'
const TOO_MANY =
  '短い間に何度も試されました。少し待ってからもう一度お試しください'
// One wording for every refusal to register, so it does not tell whether the address already has an account.
const NOT_REGISTERED = '登録できませんでした。もう一度お試しください'
const TOO_MANY_REQUESTS_STATUS = 429

/** What a reset link that is spoiled, used or expired says; the reset screen also shows it for a link that arrives with an error, and offers to ask again. */
export const RESET_LINK_EXPIRED =
  'リンクの期限が切れています。もう一度、再設定のメールを送ってください'

const BY_CODE = new Map([
  ['INVALID_EMAIL_OR_PASSWORD', 'メールアドレスかパスワードが違います'],
  ['INVALID_EMAIL', AUTH_FIELD_MESSAGE.emailInvalid],
  ['PASSWORD_TOO_SHORT', AUTH_FIELD_MESSAGE.passwordTooShort],
  ['PASSWORD_TOO_LONG', AUTH_FIELD_MESSAGE.passwordTooLong],
  ['FAILED_TO_CREATE_USER', NOT_REGISTERED],
  ['USER_ALREADY_EXISTS', NOT_REGISTERED],
  ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', NOT_REGISTERED],
  // From the pen board 「ST Phone / メール確認とパスワード再設定」: the API has mailed the link again by the time this shows.
  [
    'EMAIL_NOT_VERIFIED',
    'メールアドレスの確認がまだです。届いたメールのリンクを開いてください（確認メールを送り直しました）',
  ],
  ['INVALID_TOKEN', RESET_LINK_EXPIRED],
])

/**
 * The line the reset screen shows: the server's answer to the last try, else {@link RESET_LINK_EXPIRED} for a link that cannot work
 * (no token, or Better Auth sent it back with an error), so the user hears it before typing a password.
 * @param serverError - The error of the last try ({@link useAuthForm}'s `serverError`), or `null`.
 * @param token - The `token` query of the reset link.
 * @param linkError - The `error` query Better Auth adds to a link it found spoiled or used.
 * @returns The line for the card's alert, or `null` when the link looks usable and nothing was sent yet.
 * @example resetScreenError(null, 'abc', undefined) // => null
 * @example resetScreenError(null, undefined, undefined) // => 'リンクの期限が切れています。…'
 */
export function resetScreenError(
  serverError: string | null,
  token: string | undefined,
  linkError: string | undefined,
): string | null {
  if (serverError) return serverError
  return linkError || !token ? RESET_LINK_EXPIRED : null
}

/**
 * The Japanese line shown in the auth card for a failed sign-in or sign-up, chosen by Better Auth's error code (the rate limit
 * has none, so its status). Better Auth's own English `message` is never shown; anything unknown, and a request that never
 * reached the server, gets a plain 「もう一度お試しください」.
 * Called by {@link useAuthForm} when the request comes back with an error.
 * @param error - The `error` of Better Auth's answer, or `{}` when the request failed in transit.
 * @returns The line for the card's alert.
 * @example authErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401, message: 'Invalid email or password' }) // 'メールアドレスかパスワードが違います'
 * @example authErrorMessage({ status: 429, message: 'Too many requests. Please try again later.' }) // '短い間に何度も試されました。…'
 * @example authErrorMessage({}) // 'もう一度お試しください'
 */
export function authErrorMessage(error: AuthError): string {
  if (error.status === TOO_MANY_REQUESTS_STATUS) return TOO_MANY
  return (error.code && BY_CODE.get(error.code)) || RETRY
}

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

const BY_CODE = new Map([
  ['INVALID_EMAIL_OR_PASSWORD', 'メールアドレスかパスワードが違います'],
  ['INVALID_EMAIL', AUTH_FIELD_MESSAGE.emailInvalid],
  ['PASSWORD_TOO_SHORT', AUTH_FIELD_MESSAGE.passwordTooShort],
  ['PASSWORD_TOO_LONG', AUTH_FIELD_MESSAGE.passwordTooLong],
  ['FAILED_TO_CREATE_USER', NOT_REGISTERED],
  ['USER_ALREADY_EXISTS', NOT_REGISTERED],
  ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', NOT_REGISTERED],
])

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

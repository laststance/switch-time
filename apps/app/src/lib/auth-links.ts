import { createURL } from 'expo-linking'

/**
 * Where the confirmation link in a sign-up mail lands: the app's own sign-in screen, which says the address is confirmed. On web
 * that is this origin; on native the app's own scheme, so the link opens the app.
 * Passed as `callbackURL` by the sign-up screen (sign-in passes none: with one, Better Auth's client redirects after a sign-in that
 * went through, and the API lands the link it mails again on the same screen).
 * @returns An absolute URL Better Auth checks against its trusted origins.
 * @example confirmationLandingUrl() // => 'https://switch-time.example/sign-in?verified=1' on web
 */
export function confirmationLandingUrl(): string {
  return createURL('/sign-in', { queryParams: { verified: '1' } })
}

/**
 * Where the link in a password-reset mail lands: the app's reset screen, with the token (or the error) added by Better Auth.
 * Passed as `redirectTo` by the forgot-password screen.
 * @returns An absolute URL Better Auth checks against its trusted origins.
 * @example resetLandingUrl() // => 'https://switch-time.example/reset-password' on web
 */
export function resetLandingUrl(): string {
  return createURL('/reset-password')
}

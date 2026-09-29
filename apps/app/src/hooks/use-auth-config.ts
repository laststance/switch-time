import { useQuery } from '@tanstack/react-query'

import { authConfigOptions } from '@/lib/auth-config'
import { API_ORIGIN } from '@/lib/env'

/**
 * Whether the API confirms addresses and resets passwords by mail (it has a mail server). The auth layout asks early so sign-in
 * can show 「パスワードを忘れた方」 ({@link ForgotPasswordLink}); sign-up does not rely on it and waits for the answer itself
 * ({@link loadEmailVerification}). While it is loading, or if the API cannot say, the answer is "no" and the screens look as they
 * did before mail: a server that does confirm by mail still refuses an unconfirmed sign-in with its own message.
 * @returns `emailVerification`: true only when the API said so.
 * @example const { emailVerification } = useAuthConfig()
 */
export function useAuthConfig(): { emailVerification: boolean } {
  const { data } = useQuery(authConfigOptions(API_ORIGIN))
  return { emailVerification: data?.emailVerification ?? false }
}

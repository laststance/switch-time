import { authConfigSchema } from '@switch-time/shared'
import { useQuery } from '@tanstack/react-query'

import { API_ORIGIN } from '@/lib/env'

async function fetchAuthConfig() {
  const response = await fetch(`${API_ORIGIN}/api/auth-config`)
  if (!response.ok) throw new Error(`auth-config answered ${response.status}`)
  return authConfigSchema.parse(await response.json())
}

/**
 * Whether the API confirms addresses and resets passwords by mail (it has a mail server). The auth screens read it to show
 * 「パスワードを忘れた方」 and to say, after sign-up, that a link was mailed. Asked once per session: the answer only changes when
 * the API is redeployed. While it is loading, or if the API cannot say, the answer is "no" and the screens look as they did
 * before mail: a server that does confirm by mail still refuses an unconfirmed sign-in with its own message.
 * @returns `emailVerification`: true only when the API said so.
 * @example const { emailVerification } = useAuthConfig()
 */
export function useAuthConfig(): { emailVerification: boolean } {
  const { data } = useQuery({
    queryKey: ['auth-config'],
    queryFn: fetchAuthConfig,
    staleTime: Infinity,
  })
  return { emailVerification: data?.emailVerification ?? false }
}

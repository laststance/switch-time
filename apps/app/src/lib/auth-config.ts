import { type AuthConfig, authConfigSchema } from '@switch-time/shared'
import { type QueryClient, queryOptions } from '@tanstack/react-query'

/**
 * Asks the API whether it confirms addresses and resets passwords by mail (`GET /api/auth-config`).
 * @param origin - The API's origin (`API_ORIGIN`; empty is this origin).
 * @returns The parsed answer.
 * @throws When the API answers with an error status or something that is not an {@link AuthConfig}.
 * @example await fetchAuthConfig('http://localhost:4100') // => { emailVerification: false }
 */
async function fetchAuthConfig(origin: string): Promise<AuthConfig> {
  const response = await fetch(`${origin}/api/auth-config`)
  if (!response.ok) throw new Error(`auth-config answered ${response.status}`)
  return authConfigSchema.parse(await response.json())
}

/**
 * The query behind {@link useAuthConfig} and {@link loadEmailVerification}: asked once per session, since the answer only changes
 * when the API is redeployed.
 * @param origin - The API's origin.
 * @example useQuery(authConfigOptions(API_ORIGIN))
 */
export const authConfigOptions = (origin: string) =>
  queryOptions({
    queryKey: ['auth-config'],
    queryFn: async () => fetchAuthConfig(origin),
    staleTime: Infinity,
  })

/**
 * Makes sure the answer is in before sign-up sends its request, so the notice that follows is chosen by what the API said and
 * not by a config that was still loading. A failing API counts as "no": sign-up itself will fail then, or go through plain.
 * Called by the sign-up screen's submit.
 * @param client - The app's query client.
 * @param origin - The API's origin.
 * @returns Whether the API confirms by mail; `false` when it could not be asked.
 * @example const confirmByMail = await loadEmailVerification(queryClient, API_ORIGIN)
 */
export async function loadEmailVerification(
  client: QueryClient,
  origin: string,
): Promise<boolean> {
  const config = await client
    .ensureQueryData(authConfigOptions(origin))
    .catch(() => null)
  return config?.emailVerification ?? false
}

/**
 * What the API said, read from the cache after {@link loadEmailVerification}; `false` when nothing was answered.
 * @param client - The app's query client.
 * @returns Whether the API confirms by mail.
 * @example register(values.email, cachedEmailVerification(queryClient))
 */
export function cachedEmailVerification(client: QueryClient): boolean {
  return (
    client.getQueryData(authConfigOptions('').queryKey)?.emailVerification ??
    false
  )
}

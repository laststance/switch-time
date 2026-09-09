import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import type { AppRouterClient } from '@switch-time/api'

// Empty in the production web build (same origin behind the DigitalOcean ingress); dev talks to the Compose API.
// A device on the LAN sets EXPO_PUBLIC_API_ORIGIN to the machine's IP.
const API_ORIGIN =
  process.env.EXPO_PUBLIC_API_ORIGIN ?? (__DEV__ ? 'http://localhost:8080' : '')

const link = new RPCLink({
  url: `${API_ORIGIN}/api/rpc`,
  // Web: the Better Auth session cookie must ride along, cross-origin in dev (8081 → 8080).
  // Native: MVP-11 adds `headers: () => ({ Cookie: authClient.getCookie() })` from the Better Auth Expo client.
  fetch: async (request, init) =>
    globalThis.fetch(request, { ...init, credentials: 'include' }),
})

const client: AppRouterClient = createORPCClient(link)

/**
 * TanStack Query helpers for every API procedure, typed from {@link AppRouterClient}: server state lives here, never in Redux.
 * @example const ping = useQuery(orpc.ping.queryOptions())
 */
export const orpc = createTanstackQueryUtils(client)

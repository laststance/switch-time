import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import type { AppRouterClient } from '@switch-time/api'
import { Platform } from 'react-native'

import { authClient } from './auth-client'
import { readWholeAnswer, REQUEST_TIMEOUT_MS, withDeadline } from './deadline'
import { API_ORIGIN } from './env'

const link = new RPCLink({
  // RPCLink runs `new URL(base)` with no base of its own, so the URL must be absolute: the production web export ships
  // `API_ORIGIN` as '' (same origin behind App Platform's ingress), and the literal `/api/rpc` threw `Invalid URL` on every
  // call. Resolved per call; native always has an `API_ORIGIN`, so `window` is only read on web.
  url: () => `${API_ORIGIN || window.location.origin}/api/rpc`,
  // Web: the Better Auth session cookie must ride along, cross-origin in dev (4101 → 4100). Every call gets a deadline; oRPC
  // puts the caller's signal on the Request (its `init` holds only `redirect`), and a `signal` in `init` replaces that one, so
  // the deadline listens to `request.signal`.
  fetch: async (request, init) =>
    withDeadline(request.signal, REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await globalThis.fetch(request, {
        ...init,
        signal,
        credentials: 'include',
      })
      return readWholeAnswer(response)
    }),
  // Native has no cookie jar: replay the SecureStore session kept by the Better Auth Expo client.
  headers: async () =>
    Platform.OS === 'web' ? {} : { Cookie: await authClient.getCookie() },
})

const client: AppRouterClient = createORPCClient(link)

/**
 * TanStack Query helpers for every API procedure, typed from {@link AppRouterClient}: server state lives here, never in Redux.
 * @example const ping = useQuery(orpc.ping.queryOptions())
 */
export const orpc = createTanstackQueryUtils(client)

/** One `activities.list` row, archived ones included; screens narrow or join from it rather than redeclaring the shape. */
export type ActivityRow = Awaited<
  ReturnType<AppRouterClient['activities']['list']>
>[number]

/** One `switches` row as the API returns it: `switches.current` when there is one, each row of `switches.listByDay`. */
export type SwitchRow = NonNullable<
  Awaited<ReturnType<AppRouterClient['switches']['current']>>
>

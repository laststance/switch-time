import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { authClient } from '@/lib/auth-client'
import { orpc } from '@/lib/orpc'
import { invalidateKeys } from '@/lib/query'
import {
  optimisticSettings,
  rolledBackSettings,
  SETTINGS_DEFAULTS,
  SETTINGS_REFETCH_ROUTERS,
} from '@/lib/settings'

/**
 * The user's `settings.get` row (theme, second hand, idle threshold, unused-day rule, time zone): one query definition for the whole app,
 * gated on the session so the root theme sync can share it, {@link SETTINGS_DEFAULTS} until it has answered.
 * @example const { settings, ready } = useSettings()
 */
export function useSettings() {
  const { data: session } = authClient.useSession()
  const query = useQuery(
    orpc.settings.get.queryOptions({ enabled: Boolean(session) }),
  )
  return {
    settings: query.data ?? SETTINGS_DEFAULTS,
    ready: query.data !== undefined,
    // Whose row this is: right after a switch to another account the cache still holds the previous account's row for a commit.
    owner: query.data?.userId,
    // A failed read is not the same as a fresh account: the controls would sit on {@link SETTINGS_DEFAULTS} with nothing said.
    isError: query.isError,
    retry: () => void query.refetch(),
  }
}

/**
 * `settings.update` written into the `settings.get` cache first (a theme tap or a toggle flips at once, {@link optimisticSettings}),
 * each field it changed put back on error ({@link rolledBackSettings}); `settings.*`, `stats.*` and `switches.*` refetch once the
 * server has answered, since the idle threshold and the unused-day rule change every total and a stored-zone change moves every
 * day's window. Every write names the account signed in when it was made (`forUserId`), so the API refuses it once a sign-in in
 * another tab has changed the cookie, instead of writing it into that other account's settings.
 * @example const update = useUpdateSettings(); update.mutate({ theme: 'dark' })
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const accountId = session?.user.id
  const mutation = useMutation({
    // One scope for every settings write: two taps in flight at once could otherwise land out of order and leave the server on the
    // older one, which the invalidation below then reads back over the newer optimistic value.
    scope: { id: 'settings.update' },
    ...orpc.settings.update.mutationOptions({
      onMutate: async (input) => {
        const queryKey = orpc.settings.get.queryKey()
        await queryClient.cancelQueries({ queryKey })
        const previous = queryClient.getQueryData(queryKey)
        queryClient.setQueryData(queryKey, optimisticSettings(previous, input))
        return { previous }
      },
      onError: (_error, input, context) => {
        if (context)
          queryClient.setQueryData(orpc.settings.get.queryKey(), (current) =>
            rolledBackSettings(current, context.previous, input),
          )
      },
      // Only the last in-flight update refetches: an earlier settle would replay stale server values over a newer optimistic one.
      // That last one may be a theme tap after a zone change, so it always refetches `switches.*` too: the day lists must be
      // re-windowed, or a correction sends a baseline in the old zone and is refused.
      onSettled: async () => {
        const inFlight = queryClient.isMutating({
          mutationKey: orpc.settings.update.mutationKey(),
        })
        if (inFlight === 1)
          await invalidateKeys(
            queryClient,
            SETTINGS_REFETCH_ROUTERS.map((router) => orpc[router].key()),
          )
      },
    }),
  })
  const { mutate } = mutation
  // A write that names its own account (the zone sync, the take-back) keeps it; every other write takes the session's.
  const mutateForAccount: typeof mutate = useCallback(
    (input, options) => mutate({ forUserId: accountId, ...input }, options),
    [mutate, accountId],
  )
  return { ...mutation, mutate: mutateForAccount }
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authClient } from '@/lib/auth-client'
import { orpc } from '@/lib/orpc'
import { invalidateKeys } from '@/lib/query'
import { SETTINGS_DEFAULTS } from '@/lib/settings'

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
    // A failed read is not the same as a fresh account: the controls would sit on {@link SETTINGS_DEFAULTS} with nothing said.
    isError: query.isError,
    retry: () => void query.refetch(),
  }
}

/**
 * `settings.update` written into the `settings.get` cache first (a theme tap or a toggle flips at once), rolled back on error; `settings.*`
 * and `stats.*` refetch once the server has answered, since the idle threshold and the unused-day rule change every total.
 * @example const update = useUpdateSettings(); update.mutate({ theme: 'dark' })
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    // One scope for every settings write: two taps in flight at once could otherwise land out of order and leave the server on the
    // older one, which the invalidation below then reads back over the newer optimistic value.
    scope: { id: 'settings.update' },
    ...orpc.settings.update.mutationOptions({
      onMutate: async (input) => {
        const queryKey = orpc.settings.get.queryKey()
        await queryClient.cancelQueries({ queryKey })
        const previous = queryClient.getQueryData(queryKey)
        if (previous)
          queryClient.setQueryData(queryKey, { ...previous, ...input })
        return { previous }
      },
      onError: (_error, _input, context) => {
        if (context)
          queryClient.setQueryData(
            orpc.settings.get.queryKey(),
            context.previous,
          )
      },
      // Only the last in-flight update refetches: an earlier settle would replay stale server values over a newer optimistic one.
      onSettled: async () => {
        const inFlight = queryClient.isMutating({
          mutationKey: orpc.settings.update.mutationKey(),
        })
        if (inFlight === 1)
          await invalidateKeys(queryClient, [
            orpc.settings.key(),
            orpc.stats.key(),
          ])
      },
    }),
  })
}

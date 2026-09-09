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
  }
}

/**
 * `settings.update` written into the `settings.get` cache first (a theme tap or a toggle flips at once), rolled back on error; `settings.*`
 * and `stats.*` refetch once the server has answered, since the idle threshold and the unused-day rule change every total.
 * @example const update = useUpdateSettings(); update.mutate({ theme: 'dark' })
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation(
    orpc.settings.update.mutationOptions({
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
      onSettled: async () =>
        invalidateKeys(queryClient, [orpc.settings.key(), orpc.stats.key()]),
    }),
  )
}

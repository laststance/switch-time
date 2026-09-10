import { ORPCError } from '@orpc/client'
import { focusManager, QueryClient, type QueryKey } from '@tanstack/react-query'
import { AppState, Platform } from 'react-native'

/**
 * The single TanStack Query client: 30s staleness, one retry except on 401 (MVP-11 clears the cache and routes to sign-in instead).
 * @example <QueryClientProvider client={queryClient}>
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retrying an UNAUTHORIZED response is wasted: a session never appears by itself.
      retry: (count, error) =>
        count < 1 &&
        !(error instanceof ORPCError && error.code === 'UNAUTHORIZED'),
    },
  },
})

// Native has no window focus events: map AppState so refetchOnWindowFocus fires on resume.
// ponytail: onlineManager left on its always-online default; wire @react-native-community/netinfo when offline queueing matters.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener('change', (state) =>
      handleFocus(state === 'active'),
    )
    return () => subscription.remove()
  })
}

/**
 * Refetches every query under the given router or procedure keys: the `onSettled` of each mutation hook ({@link useSwitchTo}, {@link useCorrection}, {@link useUpdateSettings}, {@link useActivityEditor}, {@link useExcludedDays}).
 * @example onSettled: () => invalidateKeys(queryClient, [orpc.switches.key(), orpc.stats.key()])
 */
export async function invalidateKeys(
  client: QueryClient,
  queryKeys: QueryKey[],
) {
  await Promise.all(
    queryKeys.map(async (queryKey) => client.invalidateQueries({ queryKey })),
  )
}

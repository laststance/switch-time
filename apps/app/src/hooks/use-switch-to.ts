import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  confirmTap,
  isLastTap,
  placeTap,
  rollBackTap,
  SWITCH_TO_SCOPE,
} from '@/lib/optimistic-switch'
import { orpc } from '@/lib/orpc'
import { invalidateKeys } from '@/lib/query'

/**
 * `switches.switchTo` with the optimistic write the issue asks for: `switches.current` flips the moment the button is pressed,
 * a refused tap falls back to the last state the server confirmed, and the day list plus every stats query (and the settings, after
 * a detox tap) refetch once the last queued tap has been answered. Taps from this device reach the server one at a time, in the
 * order they were made.
 * @example const switchTo = useSwitchTo(); switchTo.mutate({ activityId })
 */
export function useSwitchTo() {
  const queryClient = useQueryClient()
  const queryKey = orpc.switches.current.queryKey()
  return useMutation(
    orpc.switches.switchTo.mutationOptions({
      // One scope runs the taps in series (each still flips `switches.current` at once): in parallel, a burst of hotkeys could
      // land out of order, leaving an earlier pick running, or pass the API's per-account cap and drop the last one.
      scope: { id: SWITCH_TO_SCOPE },
      onMutate: async ({ activityId }) => {
        await queryClient.cancelQueries({ queryKey })
        return placeTap(queryClient, queryKey, activityId)
      },
      onSuccess: (row, _input, context) => {
        if (context) confirmTap(context, row)
      },
      onError: (_error, _input, context) => {
        if (context) rollBackTap(queryClient, queryKey, context)
      },
      onSettled: (_row, _error, { activityId }) => {
        // A refetch now would replace the rows of the taps still queued behind this one; the last of them refetches.
        if (!isLastTap(queryClient)) return
        // Not awaited: the scope holds the next tap until this returns, and the server stamps a tap when it arrives, so waiting
        // for the stats reads would record the next switch late. The next tap's `onMutate` cancels a `current` refetch still out.
        void invalidateKeys(queryClient, [
          orpc.switches.current.key(),
          orpc.switches.listByDay.key(),
          orpc.stats.key(),
          // A detox re-tap renews only while the unused-day rule is on: a tab that missed another device turning it off learns
          // so here, instead of offering a renewal the server keeps refusing.
          ...(activityId === null ? [orpc.settings.get.key()] : []),
        ])
      },
    }),
  )
}

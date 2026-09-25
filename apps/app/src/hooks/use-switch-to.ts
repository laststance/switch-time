import { useMutation, useQueryClient } from '@tanstack/react-query'

import { orpc, type CurrentSwitch } from '@/lib/orpc'
import { invalidateKeys } from '@/lib/query'

/**
 * `switches.switchTo` with the optimistic write the issue asks for: `switches.current` flips the moment the button is pressed,
 * rolls back on error, and the day list plus every stats query refetch once the server has answered. Taps from this device
 * reach the server one at a time, in the order they were made.
 * @example const switchTo = useSwitchTo(); switchTo.mutate({ activityId })
 */
export function useSwitchTo() {
  const queryClient = useQueryClient()
  return useMutation(
    orpc.switches.switchTo.mutationOptions({
      // One scope runs the taps in series (each still flips `switches.current` at once): in parallel, a burst of hotkeys could
      // land out of order, leaving an earlier pick running, or pass the API's per-account cap and drop the last one.
      scope: { id: 'switches.switchTo' },
      onMutate: async ({ activityId }) => {
        const queryKey = orpc.switches.current.queryKey()
        await queryClient.cancelQueries({ queryKey })
        const previous = queryClient.getQueryData(queryKey)
        // Callers send only a change of state or a detox re-tap that starts a new run ({@link detoxRenewable}), so every call
        // restarts the counter right now. `id` after the spread: the placeholder row must never carry the previous row's id into
        // a correction. No run start until the refetch: the detox notices stay away and a second re-tap is dropped meanwhile.
        const next: CurrentSwitch = {
          userId: '',
          source: 'tap',
          createdAt: new Date(),
          ...previous,
          id: 'optimistic',
          revision: 0,
          activityId,
          startedAt: new Date(),
          startsRun: false,
          runStartDay: null,
        }
        queryClient.setQueryData(queryKey, next)
        return { previous }
      },
      onError: (_error, _input, context) => {
        if (context)
          queryClient.setQueryData(
            orpc.switches.current.queryKey(),
            context.previous,
          )
      },
      onSettled: async () =>
        invalidateKeys(queryClient, [
          orpc.switches.current.key(),
          orpc.switches.listByDay.key(),
          orpc.stats.key(),
        ]),
    }),
  )
}

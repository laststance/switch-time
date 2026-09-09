import { useMutation, useQueryClient } from '@tanstack/react-query'

import { orpc } from '@/lib/orpc'

type SwitchRow = NonNullable<
  Awaited<ReturnType<typeof orpc.switches.current.call>>
>

/**
 * `switches.switchTo` with the optimistic write the issue asks for: `switches.current` flips the moment the button is pressed,
 * rolls back on error, and the day list plus every stats query refetch once the server has answered.
 * @example const switchTo = useSwitchTo(); switchTo.mutate({ activityId })
 */
export function useSwitchTo() {
  const queryClient = useQueryClient()
  return useMutation(
    orpc.switches.switchTo.mutationOptions({
      onMutate: async ({ activityId }) => {
        const queryKey = orpc.switches.current.queryKey()
        await queryClient.cancelQueries({ queryKey })
        const previous = queryClient.getQueryData(queryKey)
        // Pressing the active state keeps its start (the server returns the same row); anything else restarts the counter right now.
        if (previous?.activityId !== activityId) {
          const next: SwitchRow = {
            id: 'optimistic',
            userId: '',
            source: 'tap',
            createdAt: new Date(),
            ...previous,
            activityId,
            startedAt: new Date(),
          }
          queryClient.setQueryData(queryKey, next)
        }
        return { previous }
      },
      onError: (_error, _input, context) => {
        if (context)
          queryClient.setQueryData(
            orpc.switches.current.queryKey(),
            context.previous,
          )
      },
      onSettled: async () => {
        await Promise.all(
          [
            orpc.switches.current.key(),
            orpc.switches.listByDay.key(),
            orpc.stats.key(),
          ].map(async (queryKey) =>
            queryClient.invalidateQueries({ queryKey }),
          ),
        )
      },
    }),
  )
}

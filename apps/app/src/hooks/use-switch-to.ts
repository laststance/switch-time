import type { SwitchToInput } from '@switch-time/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { authClient } from '@/lib/auth-client'
import { tapFailureMessage } from '@/lib/home'
import {
  confirmTap,
  isCurrentSession,
  isLastTap,
  placeTap,
  rollBackTap,
  sendTap,
  SWITCH_TO_SCOPE,
} from '@/lib/optimistic-switch'
import { orpc } from '@/lib/orpc'
import { invalidateKeys } from '@/lib/query'
import { useAppDispatch } from '@/store'
import { homeSlice } from '@/store/home'

/** One tap as {@link useSwitchTo} queues it: the pick, the account whose screen it was made on, and when it was pressed (epoch ms). */
type TapInput = Pick<SwitchToInput, 'activityId' | 'forUserId'> & {
  pressedAt: number
}

/**
 * `switches.switchTo` with the optimistic write the issue asks for: `switches.current` flips the moment the button is pressed,
 * a refused tap falls back to the last state the server confirmed, and the current switch, the day list and every stats query (and
 * the settings, when that tap is detox and no settings write is in flight) refetch once the last queued tap has been answered. Taps from this device reach the server one at a time, in
 * the order they were made, each for the account whose screen it was pressed on (another account's cookie by then is refused) and
 * stored at the time it was pressed ({@link sendTap}). A refused tap of the running session leaves ホーム's refusal line saying why
 * ({@link homeSlice}, {@link tapFailureMessage}); the next tap clears it.
 * @returns the tap: `activityId` is the picked activity, or `null` for detox
 * @example const switchTo = useSwitchTo(); switchTo(activityId)
 */
export function useSwitchTo(): (activityId: string | null) => void {
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const dispatch = useAppDispatch()
  const queryKey = orpc.switches.current.queryKey()
  const { mutate } = useMutation({
    mutationKey: orpc.switches.switchTo.mutationKey(),
    // One scope runs the taps in series (each still flips `switches.current` at once): in parallel, a burst of hotkeys could
    // land out of order, leaving an earlier pick running, or pass the API's per-account cap and drop the last one.
    scope: { id: SWITCH_TO_SCOPE },
    mutationFn: async ({ activityId, forUserId, pressedAt }: TapInput) =>
      sendTap(queryClient, pressedAt, async (waitedMs) =>
        orpc.switches.switchTo.call({ activityId, forUserId, waitedMs }),
      ),
    onMutate: async ({ activityId }) => {
      await queryClient.cancelQueries({ queryKey })
      return placeTap(queryClient, queryKey, activityId)
    },
    onSuccess: (row, _input, context) => {
      if (context) confirmTap(context, row)
    },
    onError: (error, _input, context) => {
      if (context) rollBackTap(queryClient, queryKey, context)
      if (isCurrentSession(queryClient, context))
        dispatch(homeSlice.actions.tapRefused(tapFailureMessage(error)))
    },
    onSettled: async (_row, _error, { activityId }, context) => {
      // A refetch now would replace the rows of the taps still queued behind this one; the last of them refetches.
      if (!isLastTap(queryClient, context)) return
      // The scope holds the next tap until this returns: the stats reads (which can scan the whole history) and the settings are
      // not awaited, so they never hold it up (it is stored at its press either way, {@link sendTap}). The day's own reads are, so
      // the tap stays in flight until the correction sheet's list has its row.
      void invalidateKeys(queryClient, [
        orpc.stats.key(),
        // A detox re-tap renews only while the unused-day rule is on: a tab that missed another device turning it off learns
        // so here, instead of offering a renewal the server keeps refusing. Not while a settings write is in flight: this read
        // could answer the old row over its optimistic value, and the write refetches the settings itself.
        ...(activityId === null &&
        queryClient.isMutating({ mutationKey: orpc.settings.key() }) === 0
          ? [orpc.settings.get.key()]
          : []),
      ])
      await invalidateKeys(queryClient, [
        orpc.switches.current.key(),
        orpc.switches.listByDay.key(),
      ])
    },
  })
  return (activityId): void => {
    dispatch(homeSlice.actions.tapPressed())
    mutate({ activityId, forUserId: session?.user.id, pressedAt: Date.now() })
  }
}

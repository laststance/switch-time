import { dayBounds, daySchema } from '@switch-time/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useLocalToday } from '@/hooks/use-local-today'
import {
  correctionRows,
  daySnapshot,
  dayTitle,
  type DaySnapshot,
} from '@/lib/correction'
import { orpc } from '@/lib/orpc'
import { useAppSelector } from '@/store'

/**
 * Everything the correction sheet needs for one day: the row model, the four `switches.*` edits and 「元に戻す」 (the rows as
 * they were before the last edit, written back through `switches.replaceDay`). Every edit invalidates `switches.*` and
 * `stats.*`, so Home and History pick it up at once. An invalid or missing `dayParam` means today.
 * @example const correction = useCorrection(params.day)
 */
export function useCorrection(dayParam: string | undefined) {
  const { today, timeZone, ready } = useLocalToday()
  const day = daySchema.safeParse(dayParam).data ?? today
  const now = useAppSelector((s) => s.clock.now)
  const queryClient = useQueryClient()
  const list = useQuery(
    orpc.switches.listByDay.queryOptions({ input: { day }, enabled: ready }),
  )
  const activities = useQuery(orpc.activities.list.queryOptions())
  const [previous, setPrevious] = useState<DaySnapshot | null>(null)
  const edit = {
    // The buttons wait for fetches, so the rows on screen are settled data when an edit snapshots them for undo.
    onMutate: () => {
      if (list.data) setPrevious(daySnapshot(list.data))
    },
    onSettled: async () => {
      await Promise.all(
        [orpc.switches.key(), orpc.stats.key()].map(async (queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
    },
  }
  const moveStart = useMutation({
    ...orpc.switches.moveStart.mutationOptions(),
    ...edit,
  })
  const changeActivity = useMutation({
    ...orpc.switches.changeActivity.mutationOptions(),
    ...edit,
  })
  const mergeIntoPrevious = useMutation({
    ...orpc.switches.mergeIntoPrevious.mutationOptions(),
    ...edit,
  })
  const splitInHalf = useMutation({
    ...orpc.switches.splitInHalf.mutationOptions(),
    ...edit,
  })
  // Undo is not itself undoable: pressing 元に戻す twice would otherwise redo the edit.
  const replaceDay = useMutation({
    ...orpc.switches.replaceDay.mutationOptions(),
    onMutate: () => setPrevious(null),
    onSettled: edit.onSettled,
  })
  const mutations = [
    moveStart,
    changeActivity,
    mergeIntoPrevious,
    splitInHalf,
    replaceDay,
  ]
  const bounds = { ...dayBounds(day, timeZone), now, timeZone }
  return {
    day,
    title: dayTitle(day, today),
    bounds,
    rows: correctionRows(list.data, activities.data, bounds),
    pending:
      list.isFetching || mutations.some((mutation) => mutation.isPending),
    canUndo: previous !== null,
    move: (id: string, deltaMinutes: 15 | -15) =>
      moveStart.mutate({ id, deltaMinutes }),
    pick: (id: string, activityId: string) =>
      changeActivity.mutate({ id, activityId }),
    merge: (id: string) => mergeIntoPrevious.mutate({ id }),
    split: (id: string) => splitInHalf.mutate({ id }),
    undo: () => {
      if (previous) replaceDay.mutate({ day, rows: previous })
    },
  }
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useLocalToday } from '@/hooks/use-local-today'
import { orpc } from '@/lib/orpc'
import { invalidateKeys } from '@/lib/query'
import { excludedRange } from '@/lib/settings'

/**
 * The 「除外中の日」 list (manual exclusions of the last year, `excludedDays.list`) and 「戻す」 (`excludedDays.include`), which also
 * refetches `stats.*` since the day rejoins every average.
 * @example const excluded = useExcludedDays(); excluded.include(day)
 */
export function useExcludedDays() {
  const { today, ready } = useLocalToday()
  const queryClient = useQueryClient()
  const list = useQuery(
    orpc.excludedDays.list.queryOptions({
      input: excludedRange(today),
      enabled: ready,
    }),
  )
  const include = useMutation({
    ...orpc.excludedDays.include.mutationOptions(),
    onSettled: async () =>
      invalidateKeys(queryClient, [orpc.excludedDays.key(), orpc.stats.key()]),
  })
  return {
    rows: list.data ?? [],
    empty: list.data?.length === 0,
    pending: [list.isFetching, include.isPending].some(Boolean),
    // A failed list would otherwise read as 除外中の日はありません, which is a different answer.
    isError: list.isError,
    retry: () => void list.refetch(),
    include: (day: string) => include.mutate({ day }),
  }
}

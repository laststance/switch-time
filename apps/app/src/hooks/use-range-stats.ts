import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { useLocalToday } from '@/hooks/use-local-today'
import { shiftMonth, weekStart, type Range } from '@/lib/history'
import { orpc } from '@/lib/orpc'

const LIVE_POLL_MS = 60_000

/**
 * The `stats.week` / `stats.month` answer behind the 記録 screen for the visible range, `offset` windows back from today (≤ 0).
 * Both observers stay mounted so flipping 週↔月 is instant, only the visible one fetches, and stepping keeps the old bars until the new answer lands.
 * The current window polls every minute: the tab stays mounted (hidden) between visits, so nothing else would move today's bar.
 * @example const { today, stats } = useRangeStats('week', -1)
 */
export function useRangeStats(range: Range, offset: number) {
  const { today, ready } = useLocalToday()
  // Only today's window changes on its own; past windows are final.
  const liveInterval = () => (offset === 0 ? LIVE_POLL_MS : false)
  const week = useQuery({
    ...orpc.stats.week.queryOptions({
      input: { startDay: weekStart(today, offset) },
    }),
    enabled: ready && range === 'week',
    placeholderData: keepPreviousData,
    refetchInterval: liveInterval,
  })
  const month = useQuery({
    ...orpc.stats.month.queryOptions({
      input: { month: shiftMonth(today.slice(0, 7), offset) },
    }),
    enabled: ready && range === 'month',
    placeholderData: keepPreviousData,
    refetchInterval: liveInterval,
  })
  return { today, stats: range === 'week' ? week.data : month.data }
}

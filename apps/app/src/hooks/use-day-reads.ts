import type { QueryCacheNotifyEvent } from '@tanstack/react-query'
import { useEffect } from 'react'

import { afterDayRead, dayOfRead } from '@/lib/correction'
import { orpc } from '@/lib/orpc'
import { queryClient } from '@/lib/query'
import { store } from '@/store'
import { afterReadActions } from '@/store/correction'

/**
 * Judges the correction sheet's kept lines and armed 「元に戻す」 by every read of a day's list that lands, sheet open or not:
 * Home's poll of today, the re-read after a failed edit, a History page. So a line the day has moved past, or a slot whose
 * replay could only be refused, is gone before that day's sheet reopens, and an uncertain failure's line waits for a real
 * read (a paused offline read never lands). Mounted once by {@link AppLayout}; the decisions live in {@link afterDayRead}.
 * @example useDayReads()
 */
export function useDayReads(): void {
  useEffect(() => queryClient.getQueryCache().subscribe(judgeDayRead), [])
}

// One query-cache update: a landed `switches.listByDay` read goes through {@link afterDayRead}, the rest are ignored.
function judgeDayRead(event: QueryCacheNotifyEvent): void {
  if (event.type !== 'updated') return
  const read = dayOfRead(event.action, event.query.queryKey)
  if (!read) return
  const { correction } = store.getState()
  const line = correction.line[read.day]
  const slot = correction.undo[read.day]
  const outcome = afterDayRead({
    line,
    slot,
    read: {
      at: Date.now(),
      ok: read.ok,
      listed: queryClient.getQueryData(
        orpc.switches.listByDay.queryKey({ input: { day: read.day } }),
      ),
    },
    // A write's own refetch lands while it still counts as in flight (its `onSettled` awaits it), so switch writes block nothing.
    zoneWriting:
      queryClient.isMutating({ mutationKey: orpc.settings.key() }) > 0,
    timeZone: queryClient.getQueryData(orpc.settings.get.queryKey())?.timeZone,
  })
  afterReadActions(outcome, {
    epoch: correction.epoch,
    day: read.day,
    line,
    slot,
  }).forEach((action) => store.dispatch(action))
}

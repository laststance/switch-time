import {
  matchMutation,
  type MutationCacheNotifyEvent,
  type QueryCacheNotifyEvent,
} from '@tanstack/react-query'
import { useEffect } from 'react'

import {
  afterDayRead,
  dayOfRead,
  isFreshList,
  isSettledWrite,
  type DayRead,
} from '@/lib/correction'
import { orpc } from '@/lib/orpc'
import { queryClient } from '@/lib/query'
import { store } from '@/store'
import { afterReadActions } from '@/store/correction'

/**
 * Judges the correction sheet's kept lines and armed 「元に戻す」 by every read of a day's list that lands, sheet open or not:
 * Home's poll of today, the re-read after a failed edit, a History page. So a line the day has moved past, or a slot whose
 * replay could only be refused, is gone before that day's sheet reopens, and an uncertain failure's line waits for a real
 * read (a paused offline read never lands). A settings write's own re-reads land while it is in flight, when a slot cannot
 * be judged, so every armed slot is judged again by its day's cached list once that write settles. Mounted once by
 * {@link AppLayout}; the decisions live in {@link afterDayRead}.
 * @example useDayReads()
 */
export function useDayReads(): void {
  useEffect(() => {
    const stopReads = queryClient.getQueryCache().subscribe(judgeDayRead)
    const stopWrites = queryClient
      .getMutationCache()
      .subscribe(judgeAfterSettingsWrite)
    return (): void => {
      stopReads()
      stopWrites()
    }
  }, [])
}

// One query-cache update: a landed `switches.listByDay` read goes through {@link afterDayRead}, the rest are ignored.
function judgeDayRead(event: QueryCacheNotifyEvent): void {
  if (event.type !== 'updated') return
  const read = dayOfRead(event.action, event.query.queryKey)
  if (!read) return
  judgeDay(read.day, {
    at: Date.now(),
    ok: read.ok,
    listed: cachedList(read.day),
  })
}

// One mutation-cache update: once the last settings write settles, every armed slot whose day's cached list is fresh (that
// write re-read it, or nothing has touched it since) is judged by it. Other days wait for their next read. Lines are left
// alone: a cached list is not a new read.
function judgeAfterSettingsWrite(event: MutationCacheNotifyEvent): void {
  const { mutation } = event
  if (!isSettledWrite(event) || !mutation) return
  if (!matchMutation({ mutationKey: orpc.settings.key() }, mutation)) return
  const { correction } = store.getState()
  Object.keys(correction.undo)
    .filter((day) => isFreshList(queryClient.getQueryState(listKey(day))))
    .forEach((day) =>
      judgeDay(
        day,
        { at: Date.now(), ok: true, listed: cachedList(day) },
        { withLine: false },
      ),
    )
}

// The query key of a day's list.
function listKey(day: string) {
  return orpc.switches.listByDay.queryKey({ input: { day } })
}

// A day's list as the cache holds it, undefined before it was read.
function cachedList(day: string) {
  return queryClient.getQueryData(listKey(day))
}

// Runs {@link afterDayRead} for one day against the store and dispatches its actions.
function judgeDay(
  day: string,
  read: DayRead,
  options: { withLine: boolean } = { withLine: true },
): void {
  const { correction } = store.getState()
  const line = options.withLine ? correction.line[day] : undefined
  const slot = correction.undo[day]
  const outcome = afterDayRead({
    line,
    slot,
    read,
    // A write's own refetch lands while it still counts as in flight (its `onSettled` awaits it), so switch writes block nothing.
    zoneWriting:
      queryClient.isMutating({ mutationKey: orpc.settings.key() }) > 0,
    timeZone: queryClient.getQueryData(orpc.settings.get.queryKey())?.timeZone,
  })
  afterReadActions(outcome, {
    epoch: correction.epoch,
    day,
    line,
    slot,
  }).forEach((action) => store.dispatch(action))
}

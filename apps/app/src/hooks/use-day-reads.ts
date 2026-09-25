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
  nextStamp,
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
 * be judged, so once that write settles every armed slot whose day's list is fresh ({@link isFreshList}) is judged by it; a
 * closed sheet's day waits for its next read. Mounted once by
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
  // Stamped and listed now, so a later read landing before the microtask cannot lend this one its list.
  const judged = { at: nextStamp(), ok: read.ok, listed: cachedList(read.day) }
  // Judged after the cache's own update: a throw here must not turn the read that landed into a failed one.
  queueMicrotask(() => judgeDay(read.day, judged))
}

// One mutation-cache update: once the last settings write settles, every armed slot whose day's cached list is fresh (a read
// landed after that write marked it stale: its re-read of a watched list, or a sheet opened meanwhile) is judged by it
// ({@link judgeArmedUndo}). Other days wait for their next read.
function judgeAfterSettingsWrite(event: MutationCacheNotifyEvent): void {
  const { mutation } = event
  if (!isSettledWrite(event) || !mutation) return
  if (!matchMutation({ mutationKey: orpc.settings.key() }, mutation)) return
  Object.keys(store.getState().correction.undo).forEach(judgeArmedUndo)
}

/**
 * Judges a day's armed 「元に戻す」 by the day's cached list, when that list is fresh ({@link isFreshList}): a read that landed
 * before the slot existed, or while a settings write was in flight, could not judge it. Called by {@link useCorrection} right
 * after an edit arms its slot, and for every armed day once a settings write settles. Lines are left alone: a cached list
 * is not a new read.
 * @param day - The day (`YYYY-MM-DD`) whose slot to judge.
 * @example judgeArmedUndo('2026-09-24')
 */
export function judgeArmedUndo(day: string): void {
  if (!isFreshList(queryClient.getQueryState(listKey(day)))) return
  judgeDay(
    day,
    { at: nextStamp(), ok: true, listed: cachedList(day) },
    { withLine: false },
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

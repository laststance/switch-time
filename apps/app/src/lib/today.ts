import { segmentsInRange } from '@switch-time/shared'

import { DETOX } from './detox'

type Row = { id: string; activityId: string | null; startedAt: Date }
type DayList = { carriedIn: Row | null; rows: Row[] }

/**
 * The 24-h bar's segments from a `switches.listByDay` answer: the state carried in from yesterday plus today's rows, sliced against `now`.
 * @example daySegments(day.data, start, end, now, 720 * 60_000)
 */
export function daySegments(
  list: DayList | undefined,
  start: number,
  end: number,
  now: number,
  idleThresholdMs: number,
) {
  const rows = list ? [list.carriedIn, ...list.rows] : []
  return segmentsInRange(
    rows
      .filter((row) => row !== null)
      .map((row) => ({
        id: row.id,
        activityId: row.activityId,
        startedAt: row.startedAt.getTime(),
      })),
    start,
    end,
    now,
    idleThresholdMs,
  )
}

/**
 * 「今日 n 回切替」: every row is one switch, except the very first row of a first day, which is the starting state.
 * @example countSwitches({ carriedIn: null, rows: [first, second] }) // 1
 */
export function countSwitches(list: DayList | undefined): number {
  if (!list) return 0
  return Math.max(0, list.rows.length - (list.carriedIn ? 0 : 1))
}

/** One 「今日の流れ」 legend entry; `color` null is detox, drawn as the solid `sub` outlined square its spans use on the bar. */
export type LegendEntry = { id: string; name: string; color: string | null }

/**
 * The 24-h bar's legend: every activity with a span today, in list order, plus detox last when a span was recorded to nothing
 * (the one span the bar draws that has no name of its own).
 * @example legendEntries(activities, segments) // [{ id: workId, name: '仕事', color: '#3B7BD9' }, { id: 'detox', name: 'detox', color: null }]
 */
export function legendEntries(
  activities: readonly { id: string; name: string; color: string }[],
  segments: readonly { activityId: string | null }[],
): LegendEntry[] {
  const drawn = new Set(segments.map((segment) => segment.activityId))
  const entries: LegendEntry[] = activities.filter((activity) =>
    drawn.has(activity.id),
  )
  if (drawn.has(null))
    entries.push({ id: 'detox', name: DETOX.name, color: DETOX.color })
  return entries
}

/** A bar's own left and right corner classes, lent to a span that touches that end. */
export type BarCorners = { first: string; last: string }

/**
 * The corner classes a span takes where it touches either end of its bar, so an outlined span there follows the rounded track
 * instead of being clipped open by it; {@link TodayFlow} and the correction sheet's day bar call it for every span they draw.
 * @param span - the span's start and end in ms
 * @param bounds - the bar's start and end in ms; a span reaching past either end counts as touching it
 * @param corners - the bar's own left and right corner classes
 * @returns
 * - `corners.first` and/or `corners.last`, space-separated, for the ends the span touches
 * - `''` for a span inside the bar
 * @example spanCorners({ start: 0, end: 5 }, { start: 0, end: 10 }, corners) // => corners.first
 */
export function spanCorners(
  span: { start: number; end: number },
  bounds: { start: number; end: number },
  corners: BarCorners,
): string {
  const touched = [
    span.start <= bounds.start ? corners.first : '',
    span.end >= bounds.end ? corners.last : '',
  ]
  return touched.filter((className) => className !== '').join(' ')
}

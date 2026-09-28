import { segmentsInRange } from '@switch-time/shared'

import { DETOX } from './detox'

type Row = {
  id: string
  activityId: string | null
  startedAt: Date
  /** A detox re-tap that renews the run: a tap, though the row before it is detox too. */
  startsRun?: boolean
}
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
 * 「今日 n 回切替」 on Home: today's rows that change the activity from the row before them (the carried-in record before the
 * first). A cut, or a merge that leaves two rows of one activity side by side (仕事, 読書, 仕事 → merge 読書), is no switch;
 * a detox re-tap that renews the run is one. The very first row of a first day is the starting state.
 * @param list - Today's `switches.listByDay` answer; undefined while it loads.
 * @returns The number of switches; 0 while the day loads.
 * @example countSwitches({ carriedIn: null, rows: [work, rest] }) // 1
 * @example countSwitches({ carriedIn: work, rows: [rest, work2] }) // 2
 * @example countSwitches({ carriedIn: work, rows: [workCut] }) // 0
 */
export function countSwitches(list: DayList | undefined): number {
  if (!list) return 0
  const [first, ...rest] = list.carriedIn
    ? [list.carriedIn, ...list.rows]
    : list.rows
  let previous = first
  let switches = 0
  for (const row of rest) {
    // A row of the same activity as the one before it only splits that record, unless it is a re-tap.
    if (row.activityId !== previous?.activityId || row.startsRun) switches += 1
    previous = row
  }
  return switches
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

/**
 * A bar's own left and right corner classes, lent to a span that touches that end, and what else such a span takes (`endSpan`):
 * a `min-w-*` the size of the corner's radius, so it is never narrower than the corner, and the classes that draw it above the
 * span next to it, over the track's own colour, so that neighbour does not cover the width it gained.
 */
export type BarCorners = { first: string; last: string; endSpan: string }

/** Where a span sits on its bar: its classes and its absolute placement, in percent of the bar. */
export type SpanBox = {
  className: string
  style: { left?: `${number}%`; right?: 0; width: `${number}%` }
}

/**
 * How a span is drawn on a bar with rounded ends: {@link TodayFlow} and the correction sheet's day bar call it for every span.
 * A span touching either end takes that end's curve, so an outlined span follows the rounded track instead of being clipped open
 * by it, and it is at least as wide as the corner and drawn above its neighbour, so a few minutes of detox right after midnight
 * (or up to the day's end) still draw a closed outline rather than an arc the corner cut or the next span covered. A span
 * touching the right end is placed from the right, so that minimum grows it into the bar, not past the end where the track
 * would clip it.
 * @param span - the span's start and end in ms
 * @param bounds - the bar's start and end in ms; a span reaching past either end counts as touching it
 * @param corners - the bar's own corner classes and what a span at an end adds
 * @returns
 * - a span inside the bar: no classes, placed from the left
 * - a span touching the start: `corners.first` and `corners.endSpan`, placed from the left
 * - a span touching the end: `corners.last` and `corners.endSpan`, placed from the right
 * @example spanBox({ start: 0, end: 5 }, { start: 0, end: 10 }, corners) // => { className: 'rounded-l-md min-w-1.5 z-10 bg-chip', style: { left: '0%', width: '50%' } }
 */
export function spanBox(
  span: { start: number; end: number },
  bounds: { start: number; end: number },
  corners: BarCorners,
): SpanBox {
  const length = bounds.end - bounds.start
  const percent = (ms: number): `${number}%` => `${(ms / length) * 100}%`
  const touchesStart = span.start <= bounds.start
  const touchesEnd = span.end >= bounds.end
  const className = [
    touchesStart ? corners.first : '',
    touchesEnd ? corners.last : '',
    touchesStart || touchesEnd ? corners.endSpan : '',
  ]
    .filter((name) => name !== '')
    .join(' ')
  const width = percent(span.end - span.start)
  // From the right at the end: a minimum width then grows the span leftwards, inside the bar.
  if (touchesEnd && !touchesStart)
    return { className, style: { right: 0, width } }
  return {
    className,
    style: { left: percent(span.start - bounds.start), width },
  }
}

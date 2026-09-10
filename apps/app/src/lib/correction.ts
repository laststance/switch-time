import type { AppRouterClient } from '@switch-time/api'
import {
  clampStart,
  MIN_SEGMENT_MS,
  type ReplaceDayInput,
} from '@switch-time/shared'

import { formatDay, formatDuration, formatTime } from './format'
import type { ActivityRow, SwitchRow } from './orpc'

/** One `switches.listByDay` answer: the day's rows plus the states carried in from before and out to after. */
export type ListedDay = Awaited<
  ReturnType<AppRouterClient['switches']['listByDay']>
>
export type CorrectionActivity = Pick<
  ActivityRow,
  'id' | 'name' | 'color' | 'iconKey'
>
/** What 「元に戻す」 keeps: the day's own rows as `switches.replaceDay` takes them. */
export type DaySnapshot = ReplaceDayInput['rows']

export type CorrectionRow = {
  id: string
  activityId: string
  name: string
  color: string
  iconKey: string
  /** The span drawn for the row, clipped to the day: the carried-in state starts at 0:00, the current state ends now. */
  start: number
  end: number
  /** `7:15`, the wall-clock start in the stored zone (the action panel's readout). */
  startLabel: string
  /** `7:15 – 7:45`; the current state reads `– いま`, a past day's last state `– 24:00`. */
  range: string
  duration: string
  /** The carried-in state belongs to the day before: it is listed last and is never selectable. */
  editable: boolean
  canMoveEarlier: boolean
  canMoveLater: boolean
  canMerge: boolean
  canSplit: boolean
}

/** The day's bounds and the clock in epoch ms, plus the stored zone the times are written in. */
export type DayBounds = {
  start: number
  end: number
  now: number
  timeZone: string
}
// Only while a cached `activities.list` predates a switch made elsewhere: the row still lists, nameless, until the refetch.
const UNKNOWN: CorrectionActivity = {
  id: '',
  name: '…',
  color: 'transparent',
  iconKey: 'home',
}

/**
 * Where a ±15 min move lands under the API's own clamp ({@link clampStart}), or null when it would not move in that direction
 * or would leave the day: the first row stays at or after 0:00, the last row before 24:00.
 * @example moveTarget(row, prev, next, bounds, -15) // row.startedAt - 15 min, or prev + 1 min, or null
 */
function moveTarget(
  row: SwitchRow,
  prev: SwitchRow | null,
  next: SwitchRow | null,
  bounds: DayBounds,
  deltaMinutes: 15 | -15,
): number | null {
  const startedAt = row.startedAt.getTime()
  const target = clampStart(
    startedAt + deltaMinutes * 60_000,
    prev?.startedAt.getTime() ?? null,
    next?.startedAt.getTime() ?? null,
    bounds.now,
  )
  if (target === null || target < bounds.start || target >= bounds.end)
    return null
  return Math.sign(target - startedAt) === Math.sign(deltaMinutes)
    ? target
    : null
}

// The end label: the open state is 「いま」, a state that runs past midnight is cut at 24:00.
function endLabel(end: number, next: SwitchRow | null, bounds: DayBounds) {
  if (end >= bounds.end) return '24:00'
  return next ? formatTime(new Date(end), bounds.timeZone) : 'いま'
}

/**
 * The sheet's rows, newest first, from one `switches.listByDay` answer: every flag the action panel needs is decided here with
 * the clamp the API applies, plus the day's floor and ceiling so no tap ever moves a row out of the day. Undefined inputs
 * (still loading) give no rows.
 * @example correctionRows(list, activities, { ...dayBounds(day, timeZone), now, timeZone }) // newest first
 */
export function correctionRows(
  list: ListedDay | undefined,
  activities: CorrectionActivity[] | undefined,
  bounds: DayBounds,
): CorrectionRow[] {
  if (!list || !activities) return []
  const timeline = [list.carriedIn, ...list.rows, list.carriedOut].filter(
    (row) => row !== null,
  )
  const byId = new Map(activities.map((activity) => [activity.id, activity]))
  return (
    timeline
      .map((row, index) =>
        describeRow(
          row,
          timeline[index - 1] ?? null,
          timeline[index + 1] ?? null,
          byId.get(row.activityId),
          bounds,
        ),
      )
      // The carried-out state only closes the last segment (it is the next day's row), and a day whose
      // first row starts at 0:00 leaves the carried-in state no span to show.
      .filter((row) => row.id !== list.carriedOut?.id)
      .filter((row) => row.editable || row.end > row.start)
      .reverse()
  )
}

// One row's texts and flags; `prev`/`next` are its neighbours in the whole timeline (the carried states included).
function describeRow(
  row: SwitchRow,
  prev: SwitchRow | null,
  next: SwitchRow | null,
  activity: CorrectionActivity = UNKNOWN,
  bounds: DayBounds,
): CorrectionRow {
  const startedAt = row.startedAt.getTime()
  const editable = startedAt >= bounds.start
  const start = Math.max(startedAt, bounds.start)
  // The segment really ends at the next switch (or now); the row only shows the part inside the day.
  const trueEnd = next?.startedAt.getTime() ?? bounds.now
  const end = Math.min(trueEnd, bounds.end)
  const midpoint = Math.floor((startedAt + trueEnd) / 2)
  const startLabel = formatTime(new Date(start), bounds.timeZone)
  return {
    id: row.id,
    activityId: row.activityId,
    name: activity.name,
    color: activity.color,
    iconKey: activity.iconKey,
    start,
    end,
    startLabel,
    range: `${startLabel} – ${endLabel(end, next, bounds)}`,
    duration: formatDuration(end - start),
    editable,
    canMoveEarlier:
      editable && moveTarget(row, prev, next, bounds, -15) !== null,
    canMoveLater: editable && moveTarget(row, prev, next, bounds, 15) !== null,
    canMerge: editable && prev !== null,
    // Both halves keep the clamp's margin and the new row stays inside the day.
    canSplit:
      editable &&
      midpoint - startedAt >= MIN_SEGMENT_MS &&
      midpoint < bounds.end,
  }
}

/**
 * The rows 「元に戻す」 writes back through `switches.replaceDay`: the day's own rows only, never the carried-in state.
 * @example const previous = daySnapshot(list.data)
 */
export function daySnapshot(list: ListedDay): DaySnapshot {
  return list.rows.map(({ activityId, startedAt }) => ({
    activityId,
    startedAt,
  }))
}

/**
 * The sheet's title: the design's 「今日の記録を訂正」, or the date for a day opened from History.
 * @example dayTitle('2026-09-08', '2026-09-09') // '9月8日（火）の記録を訂正'
 */
export function dayTitle(day: string, today: string): string {
  return day === today ? '今日の記録を訂正' : `${formatDay(day)}の記録を訂正`
}

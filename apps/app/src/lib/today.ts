import { segmentsInRange } from '@switch-time/shared'

type Row = { id: string; activityId: string; startedAt: Date }
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

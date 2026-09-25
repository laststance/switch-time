import type { AppRouterClient } from '@switch-time/api'
import { addDays } from '@switch-time/shared'

import { DETOX } from './detox'
import {
  formatDay,
  formatDuration,
  formatMonthDay,
  formatWeekday,
} from './format'
import type { ActivityRow } from './orpc'
import { cn } from './utils'

export type Range = 'week' | 'month'
/** One `stats.week` / `stats.month` answer. The screen recomputes none of it, except 状態別's detox total, summed from the days' `detoxMs` because `totals` leaves detox out. */
export type HistoryStats = Awaited<ReturnType<AppRouterClient['stats']['week']>>
type DayStat = HistoryStats['days'][number]
export type HistoryActivity = Pick<
  ActivityRow,
  'id' | 'name' | 'color' | 'iconKey' | 'targetHours' | 'archivedAt'
>

const H = 3_600_000
const DAY_MS = 24 * H
// Bar heights from the pen frames: 132 px columns for the week, 48 px calendar cells for the month.
const BAR_PX = { week: 132, month: 48 }
// The wind glyph centred in a detox cell: 14 px as in the pen's week frame, 12 px so it stays quiet in the shorter month cells.
const DETOX_GLYPH_PX = { week: 14, month: 12 }
// A detox part shorter than its own two 1 px border lines is not drawn: the outline would paint more time than it holds.
const DETOX_SLICE_MIN_PX = 2
// An excluded cell's slices stack inside its 1 px dashed border (`border` in history.tsx's CELL.excluded; the track is
// border-box), so a whole day's top slice is not clipped. Change it together with that class.
const EXCLUDED_BORDER_PX = 1

export type Slice = {
  /** `null` for the day's detox part, which belongs to no activity. */
  activityId: string | null
  /** `null` is detox ({@link DETOX}): an outline in `sub` stacked on top of the activity fills, not a fill of its own. */
  color: string | null
  height: number
  /** The topmost slice carries the rounded top corners. */
  top: boolean
  /** The slice on the track's floor carries the rounded bottom corners, so a detox outline there is not clipped by the track. */
  bottom: boolean
}

export type Cell = {
  day: string
  label: string
  today: boolean
  /**
   * `stack`, `detox` (a measured day with no activity time whose detox time is at least its idle time: outlined, nothing to
   * stack) and `excluded` link to the correction sheet; `empty` (before the first tap, or in the future) is inert.
   */
  kind: 'stack' | 'detox' | 'excluded' | 'empty'
  ariaLabel: string
  slices: Slice[]
}

export type BreakdownRow = {
  id: string
  name: string
  /** `null` is the detox row: an outlined chip and no bar fill. */
  color: string | null
  iconKey: string
  total: string
  average: string
  /** 1日あたり ÷ 「1日の目安」, capped at 1; 0 without a target (detox has none). */
  ratio: number
}

export type HistoryView = {
  title: string
  barHeight: number
  /** Size of the wind glyph drawn inside a `detox` cell. */
  detoxGlyphSize: number
  /** The 日…土 header of the month calendar; empty for the week. */
  weekdays: string[]
  /** Rows of seven; `null` pads the month calendar so cells keep their width. */
  rows: (Cell | null)[][]
  measured: string
  streak: string
  unusedDays: number
  breakdown: BreakdownRow[]
}

/**
 * First day of the trailing 7-day window `offset` weeks back (0 = the seven days ending today, the 「直近7日」 chart).
 * @example weekStart('2026-09-09', 0) // '2026-09-03'
 */
export function weekStart(today: string, offset: number): string {
  return addDays(today, offset * 7 - 6)
}

/**
 * A `YYYY-MM` month moved by `n` months, across year ends.
 * @example shiftMonth('2026-01', -1) // '2025-12'
 */
export function shiftMonth(month: string, n: number): string {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + n)
  return date.toISOString().slice(0, 7)
}

function chartTitle(
  range: Range,
  offset: number,
  first: string,
  last: string,
): string {
  if (range === 'month')
    return `${Number(first.slice(0, 4))}年${Number(first.slice(5, 7))}月`
  return offset === 0
    ? '直近7日'
    : `${formatMonthDay(first)} – ${formatMonthDay(last)}`
}

/**
 * A day cell's slices, bottom-up: the activities in `position` order (those without time skipped), then the detox part on top.
 * Called by {@link dayCell}, which passes `detoxMs` 0 for a detox day, since that cell's outline already is the detox mark.
 * @param totals - The day's activity time by activity id.
 * @param detoxMs - The day's detox time to draw on top of the activities.
 * @returns
 * - The slices, the first flagged `bottom` and the last flagged `top`
 * - The detox slice only when it is at least {@link DETOX_SLICE_MIN_PX} tall, clamped to the track left above the activities
 * @example
 * stackSlices({ work: 12 * H }, [work], 132, 6 * H)
 * // => [{ activityId: 'work', color: '#3B7BD9', height: 66, top: false, bottom: true },
 * //     { activityId: null, color: null, height: 33, top: true, bottom: false }]
 */
function stackSlices(
  totals: Record<string, number>,
  activities: HistoryActivity[],
  barHeight: number,
  detoxMs: number,
): Slice[] {
  const slices: Slice[] = activities.flatMap((activity) => {
    const ms = totals[activity.id] ?? 0
    return ms > 0
      ? [
          {
            activityId: activity.id,
            color: activity.color,
            height: (ms / DAY_MS) * barHeight,
            top: false,
            bottom: false,
          },
        ]
      : []
  })
  const activityHeight = slices.reduce((sum, slice) => sum + slice.height, 0)
  // A 25-h fall-back day can hold more than the 24-h track, so the detox part takes only the room left above the activities.
  const detoxHeight = Math.min(
    (detoxMs / DAY_MS) * barHeight,
    barHeight - activityHeight,
  )
  if (detoxHeight >= DETOX_SLICE_MIN_PX)
    slices.push({
      activityId: null,
      color: DETOX.color,
      height: detoxHeight,
      top: false,
      bottom: false,
    })
  const first = slices.at(0)
  if (first) first.bottom = true
  const last = slices.at(-1)
  if (last) last.top = true
  return slices
}

/**
 * How History's day cell draws one {@link Slice}: rounded where it meets an end of the track, detox as a solid `sub` outline
 * with no fill. Called by the 記録 screen's `DayCell`; kept here so its branches are unit tested.
 * @param slice - One slice from {@link stackSlices}.
 * @returns
 * - `className`: `rounded-t-md` on the top slice, `rounded-b-md` on the bottom one, `border-sub border` on the detox slice
 * - `backgroundColor`: the activity's colour, or `transparent` for detox
 * @example
 * sliceLook({ activityId: null, color: null, height: 33, top: true, bottom: false })
 * // => { className: 'rounded-t-md border-sub border', backgroundColor: 'transparent' }
 */
export function sliceLook(slice: Slice): {
  className: string
  backgroundColor: string
} {
  return {
    className: cn(
      slice.top && 'rounded-t-md',
      slice.bottom && 'rounded-b-md',
      slice.color === null && 'border-sub border',
    ),
    backgroundColor: slice.color ?? 'transparent',
  }
}

// What the cell's aria-label adds to the date, so the outline's meaning is read out too.
const SUFFIX = {
  stack: '',
  detox: `・${DETOX.name}`,
  excluded: '・計測なし',
  empty: '',
}

/**
 * What a day cell is drawn as. Called by {@link dayCell} before the slices, since a detox day draws no detox slice.
 * @param stat - The day's stats.
 * @param isToday - Today is a stack even before its first tap (its carried-in state is already drawing).
 * @returns
 * - `excluded` for an excluded day
 * - `detox` for a measured day (or today) with no activity time whose detox time is above 0 and at least its idle time
 * - `stack` for any other measured day, or today
 * - `empty` for an older untapped day or a future one
 * @example cellKind(day('2026-09-09', { measured: true, idleMs: 13 * H, detoxMs: 11 * H }), false) // => 'stack'
 */
function cellKind(stat: DayStat, isToday: boolean): Cell['kind'] {
  if (stat.excluded) return 'excluded'
  if (!stat.measured && !isToday) return 'empty'
  // Judged on the totals, not the slices: an activity missing from a stale list must not turn a worked day into detox.
  const hasActivityTime = Object.values(stat.totals).some((ms) => ms > 0)
  // An idle-heavy day is not claimed as a whole day of detox; it stays a stack and draws its detox part as a slice.
  const isMostlyDetox = stat.detoxMs > 0 && stat.detoxMs >= stat.idleMs
  return !hasActivityTime && isMostlyDetox ? 'detox' : 'stack'
}

function dayCell(
  stat: DayStat,
  today: string,
  range: Range,
  activities: HistoryActivity[],
): Cell {
  const isToday = stat.day === today
  const weekLabel =
    range === 'week'
      ? formatWeekday(stat.day)
      : String(Number(stat.day.slice(8)))
  const kind = cellKind(stat, isToday)
  // Only an excluded cell draws slices inside a border, so only it loses the border's width at both ends of its track.
  const trackHeight =
    kind === 'excluded' ? BAR_PX[range] - 2 * EXCLUDED_BORDER_PX : BAR_PX[range]
  const slices = stackSlices(
    stat.totals,
    activities,
    trackHeight,
    kind === 'detox' ? 0 : stat.detoxMs,
  )
  return {
    day: stat.day,
    label: isToday ? '今日' : weekLabel,
    today: isToday,
    kind,
    ariaLabel: `${formatDay(stat.day)}${SUFFIX[kind]}`,
    slices,
  }
}

// Sunday-first calendar rows, padded with null at both ends so every row has seven slots.
function calendarRows(cells: Cell[], first: string): (Cell | null)[][] {
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay()
  const padded: (Cell | null)[] = [...Array<null>(lead).fill(null), ...cells]
  while (padded.length % 7 !== 0) padded.push(null)
  return Array.from({ length: padded.length / 7 }, (_, row) =>
    padded.slice(row * 7, row * 7 + 7),
  )
}

function breakdownRows(
  stats: HistoryStats,
  activities: HistoryActivity[],
): BreakdownRow[] {
  return activities.flatMap((activity) => {
    const total = stats.totals[activity.id] ?? 0
    // Archived activities stay listed only while they still hold time in the range.
    if (activity.archivedAt !== null && total === 0) return []
    const average = stats.measuredDays > 0 ? total / stats.measuredDays : 0
    const ratio = activity.targetHours
      ? Math.min(1, average / (activity.targetHours * H))
      : 0
    return [
      {
        id: activity.id,
        name: activity.name,
        color: activity.color,
        iconKey: activity.iconKey,
        total: formatDuration(total),
        average: formatDuration(average),
        ratio,
      },
    ]
  })
}

/**
 * The 状態別 detox row, after the activities. Called by {@link historyView}: the range `totals` leave detox out, so its total is
 * summed here over the measured days, the same days 1日あたり divides by (an excluded day's detox is not counted).
 * @param stats - The range's `stats.*` answer.
 * @returns
 * - One row (outlined chip, total, 1日あたり, no bar fill) when the measured days hold detox time
 * - An empty list otherwise, so a range without detox shows no row
 * @example detoxBreakdownRow(week) // => [{ id: 'detox', name: 'detox', color: null, iconKey: 'wind', total: '6h 00m', average: '2h 00m', ratio: 0 }]
 */
function detoxBreakdownRow(stats: HistoryStats): BreakdownRow[] {
  const total = stats.days.reduce(
    (sum, stat) => (stat.measured ? sum + stat.detoxMs : sum),
    0,
  )
  if (total === 0) return []
  return [
    {
      id: 'detox',
      name: DETOX.name,
      color: DETOX.color,
      iconKey: DETOX.iconKey,
      total: formatDuration(total),
      average: formatDuration(total / stats.measuredDays),
      ratio: 0,
    },
  ]
}

/**
 * The 記録 screen's render model from one `stats.*` answer: chart title and rows, the two stat cards, the footnote count and the
 * 状態別 rows (1日あたり = total ÷ measured days, the bar against `targetHours`, detox last). Pure, so the screen only maps over it.
 * @example historyView({ range: 'week', offset: 0, today, stats: week.data, activities }).title // '直近7日'
 */
export function historyView(input: {
  range: Range
  offset: number
  today: string
  stats: HistoryStats
  activities: HistoryActivity[]
}): HistoryView {
  const { range, offset, today, stats, activities } = input
  const first = stats.days[0]?.day ?? today
  const last = stats.days.at(-1)?.day ?? today
  const cells = stats.days.map((stat) =>
    dayCell(stat, today, range, activities),
  )
  return {
    title: chartTitle(range, offset, first, last),
    barHeight: BAR_PX[range],
    detoxGlyphSize: DETOX_GLYPH_PX[range],
    weekdays: range === 'month' ? [...'日月火水木金土'] : [],
    rows: range === 'month' ? calendarRows(cells, first) : [cells],
    measured: `${stats.measuredDays} / ${stats.days.filter((stat) => stat.day <= today).length}日`,
    streak: `${stats.streak}日`,
    unusedDays: stats.excludedDays.filter(
      (entry) => entry.reason === 'auto_unused',
    ).length,
    breakdown: [
      ...breakdownRows(stats, activities),
      ...detoxBreakdownRow(stats),
    ],
  }
}

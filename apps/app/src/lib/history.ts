import type { AppRouterClient } from '@switch-time/api'
import { addDays } from '@switch-time/shared'

import {
  formatDay,
  formatDuration,
  formatMonthDay,
  formatWeekday,
} from './format'

export type Range = 'week' | 'month'
/** One `stats.week` / `stats.month` answer; the screen never recomputes what it holds. */
export type HistoryStats = Awaited<ReturnType<AppRouterClient['stats']['week']>>
type DayStat = HistoryStats['days'][number]
type ActivityRow = Awaited<
  ReturnType<AppRouterClient['activities']['list']>
>[number]
export type HistoryActivity = Pick<
  ActivityRow,
  'id' | 'name' | 'color' | 'iconKey' | 'targetHours' | 'archivedAt'
>

const H = 3_600_000
const DAY_MS = 24 * H
// Bar heights from the pen frames: 132 px columns for the week, 48 px calendar cells for the month.
const BAR_PX = { week: 132, month: 48 }

export type Slice = {
  activityId: string
  color: string
  height: number
  /** The topmost slice carries the rounded top corners. */
  top: boolean
}

export type Cell = {
  day: string
  label: string
  today: boolean
  /** `stack` and `excluded` link to the correction sheet; `empty` (before the first tap, or in the future) is inert. */
  kind: 'stack' | 'excluded' | 'empty'
  ariaLabel: string
  slices: Slice[]
}

export type BreakdownRow = {
  id: string
  name: string
  color: string
  iconKey: string
  total: string
  average: string
  /** 1日あたり ÷ 「1日の目安」, capped at 1; 0 without a target. */
  ratio: number
}

export type HistoryView = {
  title: string
  barHeight: number
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

// Slices stack bottom-up in `position` order; activities without time in the day are skipped.
function stackSlices(
  totals: Record<string, number>,
  activities: HistoryActivity[],
  barHeight: number,
): Slice[] {
  const slices = activities.flatMap((activity) => {
    const ms = totals[activity.id] ?? 0
    return ms > 0
      ? [
          {
            activityId: activity.id,
            color: activity.color,
            height: (ms / DAY_MS) * barHeight,
            top: false,
          },
        ]
      : []
  })
  const last = slices.at(-1)
  if (last) last.top = true
  return slices
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
  // Today is a stack even before its first tap (its carried-in state is already drawing); older untapped days are 計測なし.
  const kind = stat.excluded
    ? 'excluded'
    : stat.measured || isToday
      ? 'stack'
      : 'empty'
  return {
    day: stat.day,
    label: isToday ? '今日' : weekLabel,
    today: isToday,
    kind,
    ariaLabel: `${formatDay(stat.day)}${kind === 'excluded' ? '・計測なし' : ''}`,
    slices: stackSlices(stat.totals, activities, BAR_PX[range]),
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
 * The 記録 screen's render model from one `stats.*` answer: chart title and rows, the two stat cards, the footnote count and the
 * 状態別 rows (1日あたり = total ÷ measured days, the bar against `targetHours`). Pure, so the screen only maps over it.
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
    weekdays: range === 'month' ? [...'日月火水木金土'] : [],
    rows: range === 'month' ? calendarRows(cells, first) : [cells],
    measured: `${stats.measuredDays} / ${stats.days.filter((stat) => stat.day <= today).length}日`,
    streak: `${stats.streak}日`,
    unusedDays: stats.excludedDays.filter(
      (entry) => entry.reason === 'auto_unused',
    ).length,
    breakdown: breakdownRows(stats, activities),
  }
}

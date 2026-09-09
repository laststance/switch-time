import { addDays, dayBounds } from './time'

/** What the stats helpers need from a `switches` row; `startedAt` in epoch ms. */
export type SwitchLike = { id: string; activityId: string; startedAt: number }

export type Segment = {
  switchId: string
  activityId: string
  start: number
  end: number
  /** Longer than 無操作とみなす時間: shown, but left out of totals. */
  idle: boolean
}

/**
 * Slices a chronological switch list into segments clipped to [rangeStart, rangeEnd); the open one ends at `now`.
 * Idle is judged on the unclipped length, so a 13h sleep still counts as idle on the day it spills into.
 * @example segmentsInRange(rows, day.start, day.end, Date.now(), 12 * 3_600_000)
 */
export function segmentsInRange(
  switches: readonly SwitchLike[],
  rangeStart: number,
  rangeEnd: number,
  now: number,
  idleThresholdMs: number,
): Segment[] {
  const segments: Segment[] = []
  switches.forEach((current, index) => {
    const end = switches[index + 1]?.startedAt ?? now
    const start = Math.max(current.startedAt, rangeStart)
    const clippedEnd = Math.min(end, rangeEnd)
    // Entirely outside the range (or not started yet): nothing to show.
    if (clippedEnd <= start) return
    segments.push({
      switchId: current.id,
      activityId: current.activityId,
      start,
      end: clippedEnd,
      idle: end - current.startedAt > idleThresholdMs,
    })
  })
  return segments
}

/**
 * Per-activity ms of the non-idle segments plus the idle ms they exclude.
 * @example sumSegments(segments) // { totals: { [workId]: 28_800_000 }, idleMs: 0 }
 */
export function sumSegments(segments: readonly Segment[]): {
  totals: Record<string, number>
  idleMs: number
} {
  const totals: Record<string, number> = {}
  let idleMs = 0
  for (const segment of segments) {
    const length = segment.end - segment.start
    if (segment.idle) idleMs += length
    else totals[segment.activityId] = (totals[segment.activityId] ?? 0) + length
  }
  return { totals, idleMs }
}

// A corrected segment keeps at least this much room from its neighbours and from now.
const MIN_SEGMENT_MS = 60_000

/**
 * Clamps a moved start into (prev, next) and the past, ≥1 min from each; `null` arg = no neighbour, `null` result = no legal slot.
 * @example clampStart(start + 15 * 60_000, prev, next, Date.now())
 */
export function clampStart(
  proposed: number,
  prev: number | null,
  next: number | null,
  now: number,
): number | null {
  const lower = prev === null ? -Infinity : prev + MIN_SEGMENT_MS
  const upper = Math.min(next ?? Infinity, now) - MIN_SEGMENT_MS
  // Neighbours (or prev and now) closer than 2 min leave no legal slot: caller must refuse the move.
  if (lower > upper) return null
  return Math.min(Math.max(proposed, lower), upper)
}

export type ExcludedReason = 'auto_unused' | 'manual'

/** Everything {@link classifyDay} needs, gathered once per request. */
export type DayFacts = {
  /** Local days ('YYYY-MM-DD') with at least one switch. */
  switchDays: ReadonlySet<string>
  manualExcluded: ReadonlySet<string>
  /** Earliest day with a switch; null before the first tap. */
  firstDay: string | null
  today: string
  autoExcludeUnusedDays: boolean
}

export type DayStatus = { measured: boolean; excluded: ExcludedReason | null }

/**
 * Whether a day counts (計測できた日) or is 計測なし / 除外, per issue #13; the streak walks over it.
 * @example classifyDay('2026-09-07', facts) // { measured: false, excluded: 'auto_unused' }
 */
export function classifyDay(day: string, facts: DayFacts): DayStatus {
  // No state yet or not started: nothing to measure.
  if (day > facts.today || facts.firstDay === null || day < facts.firstDay)
    return { measured: false, excluded: null }
  if (facts.manualExcluded.has(day))
    return { measured: false, excluded: 'manual' }
  // Without auto-exclusion the carried-in state covers the whole day.
  if (facts.switchDays.has(day) || !facts.autoExcludeUnusedDays)
    return { measured: true, excluded: null }
  // Today is still in progress; earlier days without a tap are 計測なし.
  return day === facts.today
    ? { measured: false, excluded: null }
    : { measured: false, excluded: 'auto_unused' }
}

/**
 * 連続記録: measured days walking back from today (from yesterday while today has no tap); manual exclusions are skipped, not broken on.
 * @example streak(facts) // 12
 */
export function streak(facts: DayFacts, cap = 3650): number {
  let day = classifyDay(facts.today, facts).measured
    ? facts.today
    : addDays(facts.today, -1)
  let count = 0
  // ponytail: one classifyDay per day, capped at ~10 years; fine until someone streaks past that.
  for (let i = 0; i < cap; i++, day = addDays(day, -1)) {
    const status = classifyDay(day, facts)
    if (status.excluded === 'manual') continue
    if (!status.measured) break
    count++
  }
  return count
}

export type DayStats = DayStatus & {
  day: string
  totals: Record<string, number>
  idleMs: number
}

/**
 * The `stats.*` response for a run of days: per-day status and totals, range totals over measured days, streak, exclusions.
 * @example summarizeDays({ days, switches, facts, timeZone, now: Date.now(), idleThresholdMs })
 */
export function summarizeDays(input: {
  days: readonly string[]
  switches: readonly SwitchLike[]
  facts: DayFacts
  timeZone: string
  now: number
  idleThresholdMs: number
}): {
  days: DayStats[]
  totals: Record<string, number>
  measuredDays: number
  streak: number
  excludedDays: { day: string; reason: ExcludedReason }[]
} {
  const totals: Record<string, number> = {}
  let measuredDays = 0
  const days = input.days.map((day): DayStats => {
    const { start, end } = dayBounds(day, input.timeZone)
    const status = classifyDay(day, input.facts)
    const sums = sumSegments(
      segmentsInRange(
        input.switches,
        start,
        end,
        input.now,
        input.idleThresholdMs,
      ),
    )
    // Only measured days feed 合計／1日あたり; excluded days keep their own numbers for the detail view.
    if (status.measured) {
      measuredDays++
      for (const [activityId, ms] of Object.entries(sums.totals))
        totals[activityId] = (totals[activityId] ?? 0) + ms
    }
    return { day, ...status, ...sums }
  })
  return {
    days,
    totals,
    measuredDays,
    streak: streak(input.facts),
    excludedDays: days.flatMap((d) =>
      d.excluded ? [{ day: d.day, reason: d.excluded }] : [],
    ),
  }
}

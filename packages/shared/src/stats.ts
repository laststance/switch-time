import { addDays, dayBounds, localDay } from './time'

/** What the stats helpers need from a `switches` row; `startedAt` in epoch ms, `activityId` null = detox (recorded to no activity). */
export type SwitchLike = {
  id: string
  activityId: string | null
  startedAt: number
}

export type Segment = {
  switchId: string
  /** null = detox: drawn like any span, never totalled. */
  activityId: string | null
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
 * Per-activity ms of the non-idle segments, the idle ms they exclude, and the detox ms recorded to nothing (in neither).
 * @example sumSegments(segments) // { totals: { [workId]: 28_800_000 }, idleMs: 0, detoxMs: 3_600_000 }
 */
export function sumSegments(segments: readonly Segment[]): {
  totals: Record<string, number>
  idleMs: number
  /** Time recorded to no activity; History tells a detox-only day from an untapped one by it. */
  detoxMs: number
} {
  const totals: Record<string, number> = {}
  let idleMs = 0
  let detoxMs = 0
  for (const segment of segments) {
    const length = segment.end - segment.start
    // Detox is deliberately recorded to nothing: neither a total nor idle time, however long it ran.
    if (segment.activityId === null) detoxMs += length
    else if (segment.idle) idleMs += length
    else totals[segment.activityId] = (totals[segment.activityId] ?? 0) + length
  }
  return { totals, idleMs, detoxMs }
}

/** A corrected segment keeps at least this much room from its neighbours and from now ({@link clampStart}); a split needs twice it. */
export const MIN_SEGMENT_MS = 60_000

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

/** How far back {@link streak} walks (~10 years); {@link detoxCarriedDays} needs no older day for it. */
export const STREAK_CAP_DAYS = 3650

/** What {@link detoxCarriedDays} reads from a `switches` row. */
export type TapLike = Pick<SwitchLike, 'activityId' | 'startedAt'>

/**
 * The days a detox record runs through without a tap of their own, clipped to `window`; {@link classifyDay} measures
 * them, so a detox left on over a weekend neither breaks 連続記録 nor lists as 切替なし. The `stats.*` handler calls it
 * with every tap the account made. An activity left running gets no such day: it is usually a forgotten tap.
 * @param taps - Every tap of the account, in any order; `activityId` null is detox.
 * @param timeZone - The user's stored zone.
 * @param window - The first and last day to report (inclusive); records reaching past it are clipped.
 * @returns The covered days: from the day after the detox tap to the day before the next tap, or to `window.to` while it runs.
 * @example detoxCarriedDays([{ activityId: null, startedAt: fri22h }, { activityId: work, startedAt: mon9h }], 'Asia/Tokyo', { from: '2026-09-01', to: '2026-09-30' }) // Set { sat, sun }
 */
export function detoxCarriedDays(
  taps: readonly TapLike[],
  timeZone: string,
  window: { from: string; to: string },
): Set<string> {
  const ordered = [...taps].sort((a, b) => a.startedAt - b.startedAt)
  const days = new Set<string>()
  ordered.forEach((tap, index) => {
    if (tap.activityId !== null) return
    const next = ordered[index + 1]
    const dayAfterTap = addDays(localDay(new Date(tap.startedAt), timeZone), 1)
    // A running detox reaches the window's end; one ended by a later tap stops before that tap's own day.
    const lastCovered = next
      ? addDays(localDay(new Date(next.startedAt), timeZone), -1)
      : window.to
    const from = dayAfterTap > window.from ? dayAfterTap : window.from
    const to = lastCovered < window.to ? lastCovered : window.to
    // Records never overlap, so all of them together walk at most the window's length.
    for (let day = from; day <= to; day = addDays(day, 1)) days.add(day)
  })
  return days
}

/** Everything {@link classifyDay} needs, gathered once per request. */
export type DayFacts = {
  /** Local days ('YYYY-MM-DD') with at least one switch. */
  switchDays: ReadonlySet<string>
  /** Untapped days a detox record runs through ({@link detoxCarriedDays}); measured like a tapped day. */
  detoxDays: ReadonlySet<string>
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
  // A tap or a detox left on measures the day; without auto-exclusion any carried-in state does.
  if (
    facts.switchDays.has(day) ||
    facts.detoxDays.has(day) ||
    !facts.autoExcludeUnusedDays
  )
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
export function streak(facts: DayFacts, cap = STREAK_CAP_DAYS): number {
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
  detoxMs: number
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

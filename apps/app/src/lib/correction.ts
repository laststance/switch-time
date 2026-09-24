import { ORPCError } from '@orpc/client'
import type { AppRouterClient } from '@switch-time/api'
import {
  DAY_ROWS_MAX,
  clampStart,
  localDay,
  MIN_SEGMENT_MS,
  REFUSAL,
  refusalDataSchema,
  type DayBaseline,
  type DayRow,
  type RefusalReason,
  type ReplaceDayInput,
} from '@switch-time/shared'

import { RequestTimeoutError } from './deadline'
import { DETOX } from './detox'
import { formatDay, formatDuration, formatMonthDay, formatTime } from './format'
import type { ActivityRow, SwitchRow } from './orpc'
import { idleLabel } from './settings'

/** One `switches.listByDay` answer: the day's rows plus the states carried in from before and out to after. */
export type ListedDay = Awaited<
  ReturnType<AppRouterClient['switches']['listByDay']>
>
/** What a row is drawn with; `color` null is detox, which has no colour of its own (outlined, never filled). */
export type CorrectionActivity = Pick<ActivityRow, 'id' | 'name' | 'iconKey'> &
  Partial<Pick<ActivityRow, 'archivedAt'>> & {
    color: ActivityRow['color'] | null
  }
/** What 「元に戻す」 keeps: the day's own rows as `switches.replaceDay` takes them. */
export type DaySnapshot = ReplaceDayInput['rows']
/** Where 「ここで分割」 may cut the carried-in record, in epoch ms on the stored zone's quarter hours; `initial` is where 区切る時刻 opens. */
export type CutRange = { min: number; max: number; initial: number }

export type CorrectionRow = {
  id: string
  /** null = detox. */
  activityId: string | null
  /** The record's revision as listed: every write that changes its activity or where it ends moves it on. A carried-in
   * pick names it, so a record reshaped elsewhere since is refused. */
  revision: number
  name: string
  color: string | null
  iconKey: string
  /** The span drawn for the row, clipped to the day: the carried-in state starts at 0:00, the current state ends now. */
  start: number
  end: number
  /** `7:15`, the wall-clock start in the stored zone (the action panel's readout). */
  startLabel: string
  /** `7:15 – 7:45`; the current state reads `– いま`, a past day's last state `– 24:00`. */
  range: string
  duration: string
  /** The record started before the day (listed last): its panel cuts it or changes its activity, and never moves or merges it. */
  carriedIn: boolean
  /** `9月23日`, the day the record really started (the scope note names whose totals a pick also changes); empty on the day's own rows. */
  trueStartDate: string
  /** `9月23日 23:00`, the record's real start with its date (the carried-in panel's origin note); empty on the day's own rows. */
  trueStartLabel: string
  /** The row's activity was archived since: the picker cannot offer it back (the carried-in panel's warning). */
  archived: boolean
  /** The whole record, the part before the day included, as the idle rule measures it: its real start, and the next switch or now. */
  trueStart: number
  trueEnd: number
  /** 区切る時刻's range on a carried-in row; null on the day's own rows and when no quarter hour fits. */
  cut: CutRange | null
  canMoveEarlier: boolean
  canMoveLater: boolean
  canMergePrevious: boolean
  canMergeNext: boolean
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
// A detox row joins no activity: it names itself and has no colour, so the chip and the bar draw it outlined.
const DETOX_ROW: CorrectionActivity = { id: '', ...DETOX }

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
  const activityOf = (row: SwitchRow) =>
    row.activityId === null ? DETOX_ROW : byId.get(row.activityId)
  return (
    timeline
      .map((row, index) => {
        const prev = timeline[index - 1] ?? null
        return describeRow(
          row,
          prev,
          timeline[index + 1] ?? null,
          activityOf(row),
          bounds,
          Boolean(prev && activityOf(prev)?.archivedAt),
        )
      })
      // The carried-out state only closes the last segment (it is the next day's row), and a day whose
      // first row starts at 0:00 leaves the carried-in state no span to show.
      .filter((row) => row.id !== list.carriedOut?.id)
      .filter((row) => !row.carriedIn || row.end > row.start)
      .reverse()
  )
}

const QUARTER_MS = 15 * 60_000
// How far a device clock may run ahead of the server's before 区切る時刻 would offer a cut `switches.splitAt` refuses.
const CLOCK_SKEW_MARGIN_MS = 15 * 60_000

/**
 * 区切る時刻's range for a record from `startedAt` to `trueEnd`: quarter hours of the viewed day (counted from its 0:00, so any
 * zone offset works) that keep a minute from the record's true start and from its end, as `switches.splitAt` checks, and stay
 * a quarter short of now so a device clock running fast cannot offer a cut the server refuses.
 * 0:00 itself is allowed, since midnight is not a switch. The opening value is the middle quarter, a tie rounding down.
 * @example cutRange(nineSevenTwentyTwo, nineEightSeven, bounds) // { min: 0:00, max: 6:45, initial: 3:15 }
 */
function cutRange(
  startedAt: number,
  trueEnd: number,
  bounds: DayBounds,
): CutRange | null {
  const floor = Math.max(startedAt + MIN_SEGMENT_MS, bounds.start)
  const ceiling =
    Math.min(trueEnd, bounds.end, bounds.now - CLOCK_SKEW_MARGIN_MS) -
    MIN_SEGMENT_MS
  const min =
    bounds.start + Math.ceil((floor - bounds.start) / QUARTER_MS) * QUARTER_MS
  const max =
    bounds.start +
    Math.floor((ceiling - bounds.start) / QUARTER_MS) * QUARTER_MS
  // No quarter hour keeps a minute from both ends: 「ここで分割」 is disabled.
  if (min > max) return null
  const quarters = (max - min) / QUARTER_MS
  return { min, max, initial: min + Math.floor(quarters / 2) * QUARTER_MS }
}

const NO_TRUE_START = { trueStartDate: '', trueStartLabel: '' }

// The earlier day a carried-in row really started on; only carried-in rows pay for these two formats per tick.
function trueStartLabels(
  startedAt: Date,
  bounds: DayBounds,
): Pick<CorrectionRow, 'trueStartDate' | 'trueStartLabel'> {
  const trueStartDate = formatMonthDay(localDay(startedAt, bounds.timeZone))
  return {
    trueStartDate,
    trueStartLabel: `${trueStartDate} ${formatTime(startedAt, bounds.timeZone)}`,
  }
}

// One row's texts and flags; `prev`/`next` are its neighbours in the whole timeline (the carried states included), and
// `prevArchived` says whether the previous row's activity is archived.
function describeRow(
  row: SwitchRow,
  prev: SwitchRow | null,
  next: SwitchRow | null,
  activity: CorrectionActivity = UNKNOWN,
  bounds: DayBounds,
  prevArchived: boolean,
): CorrectionRow {
  const startedAt = row.startedAt.getTime()
  const carriedIn = startedAt < bounds.start
  const start = Math.max(startedAt, bounds.start)
  // The segment really ends at the next switch (or now); the row only shows the part inside the day.
  const trueEnd = next?.startedAt.getTime() ?? bounds.now
  const end = Math.min(trueEnd, bounds.end)
  const startLabel = formatTime(new Date(start), bounds.timeZone)
  return {
    id: row.id,
    activityId: row.activityId,
    revision: row.revision,
    name: activity.name,
    color: activity.color,
    iconKey: activity.iconKey,
    start,
    end,
    startLabel,
    range: `${startLabel} – ${endLabel(end, next, bounds)}`,
    duration: formatDuration(end - start),
    carriedIn,
    ...(carriedIn ? trueStartLabels(row.startedAt, bounds) : NO_TRUE_START),
    archived: Boolean(activity.archivedAt),
    trueStart: startedAt,
    trueEnd,
    cut: carriedIn ? cutRange(startedAt, trueEnd, bounds) : null,
    ...(carriedIn
      ? LOCKED
      : ownRowFlags(row, prev, next, bounds, prevArchived)),
  }
}

type RowFlags = Pick<
  CorrectionRow,
  | 'canMoveEarlier'
  | 'canMoveLater'
  | 'canMergePrevious'
  | 'canMergeNext'
  | 'canSplit'
>
// Moving, merging or halving the carried-in record would rewrite the earlier day, which 「元に戻す」 cannot restore.
const LOCKED: RowFlags = {
  canMoveEarlier: false,
  canMoveLater: false,
  canMergePrevious: false,
  canMergeNext: false,
  canSplit: false,
}

// The action panel's flags for one of the day's own rows, with the clamp the API applies and the day's floor and ceiling.
function ownRowFlags(
  row: SwitchRow,
  prev: SwitchRow | null,
  next: SwitchRow | null,
  bounds: DayBounds,
  prevArchived: boolean,
): RowFlags {
  const startedAt = row.startedAt.getTime()
  const trueEnd = next?.startedAt.getTime() ?? bounds.now
  const midpoint = Math.floor((startedAt + trueEnd) / 2)
  return {
    canMoveEarlier: moveTarget(row, prev, next, bounds, -15) !== null,
    canMoveLater: moveTarget(row, prev, next, bounds, 15) !== null,
    // Merging the running record makes the previous one the current state, which the API refuses for an archived activity.
    canMergePrevious: prev !== null && (next !== null || !prevArchived),
    // Merging moves the next row back to this row's start, so that row must be the day's own: 「元に戻す」 rewrites this day
    // only, and would drop the next day's first switch for good.
    canMergeNext: next !== null && trueEnd < bounds.end,
    // Both halves keep the clamp's margin and the new row stays inside the day.
    canSplit: midpoint - startedAt >= MIN_SEGMENT_MS && midpoint < bounds.end,
  }
}

/**
 * The rows 「元に戻す」 writes back through `switches.replaceDay`: the day's own rows only, never the carried-in state.
 * @example const previous = daySnapshot(baseline.rows)
 */
export function daySnapshot(
  rows: readonly Pick<DayRow, 'activityId' | 'startedAt'>[],
): DaySnapshot {
  return rows.map(({ activityId, startedAt }) => ({
    activityId,
    startedAt,
  }))
}

// A row as a baseline or 「元に戻す」's `expected` compares it: id, activity and start.
const listedRow = ({
  id,
  activityId,
  startedAt,
}: Pick<SwitchRow, 'id' | 'activityId' | 'startedAt'>): DayRow => ({
  id,
  activityId,
  startedAt,
})

/**
 * The day as the sheet listed it, sent with every edit the day undo covers: the API refuses the edit unless the day still
 * reads exactly so under the same stored zone, which makes the list the day's true state before the edit. On a day busier
 * than {@link DAY_ROWS_MAX} it lists no rows, so the request stays small: the API still checks the zone and the records on
 * either side, and no day undo is armed.
 * @param day - The sheet's day.
 * @param timeZone - The stored zone the list was windowed in.
 * @param list - The `switches.listByDay` answer the button was pressed on.
 * @returns The baseline: the day's own rows with their ids, oldest first (left out on a busy day), the carried-in record with
 *   its revision and the first switch after the day (null: none).
 * @example dayBaseline('2026-09-08', 'Asia/Tokyo', list) // { day, timeZone, rows: [{ id, activityId, startedAt }, …], carriedIn: { id: 'c', revision: 2 }, carriedOutId: 'n' }
 */
export function dayBaseline(
  day: string,
  timeZone: string,
  list: ListedDay,
): DayBaseline {
  const sides = {
    day,
    timeZone,
    carriedIn: list.carriedIn
      ? { id: list.carriedIn.id, revision: list.carriedIn.revision }
      : null,
    carriedOutId: list.carriedOut?.id ?? null,
  }
  if (list.rows.length > DAY_ROWS_MAX) return sides
  return { ...sides, rows: list.rows.map(listedRow) }
}

/**
 * The day's own rows once an edit has landed, from the baseline the API checked and the row the edit returned: the edit
 * wrote nothing else, since the API ran it under the user's lock right after that check. A merge deletes the edited row;
 * the returned row (moved, re-activitied, the merge's kept neighbour, a split's new part) replaces its id or joins; rows
 * outside the day drop (a merge into the carried-in record keeps that record on its own day). 「元に戻す」 sends these as
 * `expected`, so it is refused once anything else has touched the day.
 * @param before - The baseline's rows.
 * @param edit - The edit and the row it returned.
 * @param editedId - The row the edit was made on.
 * @param window - The day's [start, end) in epoch ms.
 * @returns The day's rows after the edit, oldest first.
 * @example rowsAfterEdit(before, { kind: 'merge', returned: work }, rest.id, bounds) // before without 休息, 仕事 as returned
 */
export function rowsAfterEdit(
  before: readonly DayRow[],
  edit: CorrectionEdit,
  editedId: string,
  window: Pick<DayBounds, 'start' | 'end'>,
): DayRow[] {
  const returned = listedRow(edit.returned)
  const untouched = before.filter(
    (row) =>
      row.id !== returned.id && !(edit.kind === 'merge' && row.id === editedId),
  )
  return [...untouched, returned]
    .filter((row) => {
      const time = row.startedAt.getTime()
      return time >= window.start && time < window.end
    })
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
}

/**
 * The sheet's title: the design's 「今日の記録を訂正」, or the date for a day opened from History.
 * @example dayTitle('2026-09-08', '2026-09-09') // '9月8日（火）の記録を訂正'
 */
export function dayTitle(day: string, today: string): string {
  return day === today ? '今日の記録を訂正' : `${formatDay(day)}の記録を訂正`
}

/** The four 区切る時刻 steps in minutes of elapsed time (like 開始時刻's ±15), in button order. */
export const CUT_STEPS = [-60, -15, 15, 60] as const
export type CutStepMinutes = (typeof CUT_STEPS)[number]
/** The time the user stepped 区切る時刻 to, and on which row; the panel keeps it in local state. */
export type ChosenCut = { id: string; at: number }
/**
 * The cut time the carried-in panel opens with: the range's middle as it is when the panel mounts, kept as a choice so
 * today's clock, which moves the range's end and so its middle, never shifts the time under the user's finger.
 * @param row - The carried-in row the panel opens on.
 * @returns The row's `initial` as a {@link ChosenCut}, or null when the row has no cut range.
 * @example openedCut(carriedIn) // { id: 'w', at: 3:15 }
 */
export function openedCut(row: CorrectionRow): ChosenCut | null {
  return row.cut ? { id: row.id, at: row.cut.initial } : null
}

/** What the 区切る時刻 row draws: the cut time (null = no cut), its readout, and where each step lands (null = disabled). */
export type CutStepper = {
  at: number | null
  label: string
  targets: Record<CutStepMinutes, number | null>
}

/**
 * The 区切る時刻 stepper of the selected carried-in row: a chosen time stays while it is inside the row's current range (so
 * today's clock never moves it), and anything else (another row's choice, a time a cut or an undo left outside) opens at
 * `initial`. Steps clamp to the range; a step that cannot move is disabled. Read by the carried-in panel at every render.
 * @param row - The selected row; only a carried-in one has a range.
 * @param chosen - The last stepped time, or null before any step.
 * @param timeZone - The stored zone the readout is written in.
 * @returns
 * - With a range: the time to cut at, its `H:MM`, and each step's landing time or null at the range's edge
 * - Without one: at null, the readout `—`, every step null
 * @example cutStepper(carriedIn, null, 'Asia/Tokyo') // { at: 3:15, label: '3:15', targets: { -60: 2:15, …, 60: 4:15 } }
 */
export function cutStepper(
  row: CorrectionRow,
  chosen: ChosenCut | null,
  timeZone: string,
): CutStepper {
  const { cut } = row
  if (!cut)
    return {
      at: null,
      label: '—',
      targets: { [-60]: null, [-15]: null, [15]: null, [60]: null },
    }
  const kept =
    chosen?.id === row.id && chosen.at >= cut.min && chosen.at <= cut.max
  const at = kept ? chosen.at : cut.initial
  const step = (minutes: CutStepMinutes): number | null => {
    const target = Math.min(Math.max(at + minutes * 60_000, cut.min), cut.max)
    return target === at ? null : target
  }
  return {
    at,
    label: formatTime(new Date(at), timeZone),
    targets: {
      [-60]: step(-60),
      [-15]: step(-15),
      [15]: step(15),
      [60]: step(60),
    },
  }
}

/** The day facts the cut's effect on the totals depends on; the hook reads them from settings and the excluded-day list. */
export type TotalsFacts = {
  idleThresholdMs: number
  autoExcludeUnusedDays: boolean
  /** Null while the excluded-day list is loading: the 計測 note waits rather than guess. */
  manuallyExcluded: boolean | null
  hasOwnRows: boolean
  isToday: boolean
}
/** 'idle': the cut turns idle time into counted time; 'unmeasured': the day becomes 計測できた日. */
export type TotalsEffect = 'idle' | 'unmeasured'

/**
 * Whether a cut at `at` takes time out of the idle count: the whole record is over the threshold, and at least one of
 * the two parts is not (`segmentsInRange` measures each part by its own length). Detox is never idle, so it has no effect.
 * @param row - The carried-in row, with the whole record's true start and end.
 * @param idleThresholdMs - The user's idle threshold.
 * @param at - The cut time, or null when the day has no quarter hour to cut at.
 * @returns True when the note 「無操作扱い…が集計に入ります」 is accurate for this cut.
 * @example cutFreesIdle(row26h, 43_200_000, at1245) // true: the later part is 11h15
 */
function cutFreesIdle(
  row: CorrectionRow,
  idleThresholdMs: number,
  at: number | null,
): boolean {
  if (row.activityId === null || at === null) return false
  if (row.trueEnd - row.trueStart <= idleThresholdMs) return false
  return (
    at - row.trueStart <= idleThresholdMs || row.trueEnd - at <= idleThresholdMs
  )
}

/**
 * How a cut of the carried-in record would change the totals, one line each under 「ここで分割」: a record over the idle
 * threshold counts nowhere until a cut leaves a part under it ({@link cutFreesIdle}), and a past day without a switch
 * of its own is 計測なし under auto-exclusion until the cut adds one (`classifyDay`).
 * @param row - The selected row; the day's own rows have no cut and no effect.
 * @param facts - The settings and day facts the two rules read.
 * @param at - The stepper's cut time, or null when there is none.
 * @returns The effects in display order; empty when the cut changes nothing in the totals.
 * @example cutTotalsEffects(carriedIn, { idleThresholdMs: 43_200_000, autoExcludeUnusedDays: true, manuallyExcluded: false, hasOwnRows: false, isToday: false }, at) // ['idle', 'unmeasured']
 */
export function cutTotalsEffects(
  row: CorrectionRow,
  facts: TotalsFacts,
  at: number | null,
): TotalsEffect[] {
  if (!row.carriedIn) return []
  const effects: TotalsEffect[] = []
  if (cutFreesIdle(row, facts.idleThresholdMs, at)) effects.push('idle')
  // Today is never 計測なし yet, a manual exclusion outranks a switch, and an unloaded list says nothing.
  if (
    !facts.isToday &&
    !facts.hasOwnRows &&
    facts.autoExcludeUnusedDays &&
    facts.manuallyExcluded === false
  )
    effects.push('unmeasured')
  return effects
}

/**
 * Whether the user excluded `day` by hand, from the excluded-day query for that one day; feeds {@link TotalsFacts}.
 * @param rows - The query's rows, undefined while it loads.
 * @param day - The viewed day, `YYYY-MM-DD`.
 * @returns Null while loading, then whether a manual exclusion covers the day.
 * @example isManuallyExcluded([{ day: '2026-09-08', reason: 'manual' }], '2026-09-08') // true
 */
export function isManuallyExcluded(
  rows: readonly { day: string; reason: string }[] | undefined,
  day: string,
): boolean | null {
  if (rows === undefined) return null
  return rows.some((row) => row.day === day && row.reason === 'manual')
}

/**
 * The lines under 「ここで分割」: one per way the cut changes the totals ({@link cutTotalsEffects}), or the reason the cut is
 * disabled when no quarter hour fits.
 * @param row - The selected carried-in row.
 * @param facts - The settings and day facts the totals rules read.
 * @param at - The stepper's cut time, which decides whether a part leaves the idle count.
 * @returns The lines in display order; empty when there is nothing to say.
 * @example cutNotes(carriedIn, facts, at) // ['区切ると、無操作扱い（12時間超）だった時間が集計に入ります']
 */
export function cutNotes(
  row: CorrectionRow,
  facts: TotalsFacts,
  at: number | null,
): string[] {
  if (!row.cut) return ['15分単位で区切れる時刻がありません']
  return cutTotalsEffects(row, facts, at).map((effect) =>
    effect === 'idle'
      ? `区切ると、無操作扱い（${idleLabel(facts.idleThresholdMs / 60_000)}超）だった時間が集計に入ります`
      : '区切ると、この日は計測できた日になります',
  )
}

/**
 * What 「元に戻す」 holds. `day`: the day's rows before the edit, written back through `switches.replaceDay` only while the
 * stored zone is still `timeZone`, the day still holds exactly `expected`, the rows the edit left, and its last row still
 * runs into `carriedOutId` (an edit on the day never changes it, so it is the baseline's); `reselectId` is the
 * carried-in row a cut came from, selected again once the undo lands. `activity`: a pick on the carried-in record, put back
 * through `switches.changeActivity` only while the record is still at the `revision` the pick left, since that record
 * reaches another day (a record's revision does not depend on any day's window, so it carries no zone).
 */
export type UndoSlot =
  | {
      kind: 'day'
      day: string
      timeZone: string
      rows: DaySnapshot
      expected: DayRow[]
      carriedOutId: DayBaseline['carriedOutId']
      reselectId: string | null
    }
  | {
      kind: 'activity'
      day: string
      id: string
      to: string | null
      revision: number
    }
/**
 * The sheet's edits, as far as the undo cares, with the row the procedure returned: `cut` is 「ここで分割」 on a carried-in
 * row, `split` is 半分で分割. A pick's returned row carries the revision its write left.
 */
export type CorrectionEdit = {
  kind: 'move' | 'pick' | 'merge' | 'split' | 'cut'
  returned: Pick<SwitchRow, 'id' | 'activityId' | 'startedAt' | 'revision'>
}

/**
 * The undo an edit arms once it succeeds, from the rows as they were when the button was pressed (the baseline the API
 * checked). A pick on the carried-in record arms an activity undo, or nothing when its activity is archived (the picker
 * cannot offer it back, and an older undo must not replay either); every other edit arms the day undo, unless the baseline
 * listed no rows (a day busier than {@link DAY_ROWS_MAX}), which leaves nothing to write back. Called by the sheet's edits
 * once they land.
 * @param edit - The edit just made and the row it returned.
 * @param row - The row it was made on, before the edit.
 * @param baseline - The day as the sheet listed it when the button was pressed; undefined before the day's list arrived.
 * @param window - The day's [start, end) in epoch ms.
 * @returns
 * - A carried-in pick: `{ kind: 'activity', … }`, or `{ blocked: 'archived' }`
 * - Anything else: `{ kind: 'day', … }` with the rows the edit left as `expected`, remembering the carried-in row after a cut
 * - null with no baseline or a busy day's: no undo, and the caller drops any older one
 * @example undoSlotFor({ kind: 'pick', returned }, carriedIn, baseline, bounds) // { kind: 'activity', id, to: 'work', revision: 4, … }
 */
export function undoSlotFor(
  edit: CorrectionEdit,
  row: CorrectionRow,
  baseline: DayBaseline | undefined,
  window: Pick<DayBounds, 'start' | 'end'>,
): UndoSlot | { blocked: 'archived' } | null {
  if (!baseline) return null
  if (edit.kind === 'pick' && row.carriedIn) {
    if (row.archived) return { blocked: 'archived' }
    return {
      kind: 'activity',
      day: baseline.day,
      id: row.id,
      to: row.activityId,
      revision: edit.returned.revision,
    }
  }
  if (!baseline.rows) return null
  return {
    kind: 'day',
    day: baseline.day,
    timeZone: baseline.timeZone,
    rows: daySnapshot(baseline.rows),
    expected: rowsAfterEdit(baseline.rows, edit, row.id, window),
    carriedOutId: baseline.carriedOutId,
    reselectId: edit.kind === 'cut' ? row.id : null,
  }
}

/** `switches.changeActivity`'s input; `revision` makes the write conditional on no other write having reached the record. */
export type ChangeActivityInput = Parameters<
  AppRouterClient['switches']['changeActivity']
>[0]
/** The call 「元に戻す」 makes for a slot; `reselectId` is the row to select once the day undo lands. */
export type UndoRequest =
  | {
      procedure: 'replaceDay'
      input: ReplaceDayInput
      reselectId: string | null
    }
  | { procedure: 'changeActivity'; input: ChangeActivityInput }

/**
 * The call behind 「元に戻す」 for the armed slot: the day's rows back through `replaceDay`, conditional on the day still
 * holding the rows the edit left under the same zone, or the carried-in record's previous activity through `changeActivity`,
 * conditional on the record still being at the revision the pick left.
 * @param slot - The armed undo.
 * @returns The procedure and its input; a day undo also names the row to select after it (the carried-in row a cut came from).
 * @example undoRequest({ kind: 'activity', day, id: 'w', to: 'work', revision: 4 }) // { procedure: 'changeActivity', input: { id: 'w', activityId: 'work', revision: 4 } }
 */
export function undoRequest(slot: UndoSlot): UndoRequest {
  if (slot.kind === 'day')
    return {
      procedure: 'replaceDay',
      input: {
        day: slot.day,
        timeZone: slot.timeZone,
        expected: slot.expected,
        carriedOutId: slot.carriedOutId,
        rows: slot.rows,
      },
      reselectId: slot.reselectId,
    }
  return {
    procedure: 'changeActivity',
    input: { id: slot.id, activityId: slot.to, revision: slot.revision },
  }
}

/**
 * What a failed undo of either kind does to 「元に戻す」: an answer that can never succeed turns it off (the day or the record
 * changed elsewhere, or is gone, silently; the previous activity was archived, with the notice), and so does a timeout, which
 * may have landed (a second press would then be refused as another device's change). A passing failure (network, server
 * error, an expired sign-in) keeps it for another try.
 * @param error - The error the undo's mutation failed with.
 * @returns
 * - 'clear': CONFLICT (`replaceDay`'s day-changed, `changeActivity`'s stale revision), NOT_FOUND, or a {@link RequestTimeoutError}
 * - 'archived': BAD_REQUEST with `data.reason === 'archived'` (`changeActivity` refuses an archived target; `replaceDay` refuses
 *   a day whose current state would name one)
 * - 'keep': anything else, another BAD_REQUEST included
 * @example afterUndoFailure(new ORPCError('CONFLICT')) // 'clear'
 */
export function afterUndoFailure(
  error: unknown,
): 'keep' | 'clear' | 'archived' {
  if (error instanceof RequestTimeoutError) return 'clear'
  if (!(error instanceof ORPCError)) return 'keep'
  if (error.code === 'CONFLICT' || error.code === 'NOT_FOUND') return 'clear'
  return error.code === 'BAD_REQUEST' &&
    refusalReason(error) === REFUSAL.archived.reason
    ? 'archived'
    : 'keep'
}

/**
 * Whether an edit or undo was refused because its day no longer reads as the sheet listed it (`REFUSAL.dayChanged`).
 * The sheet's edits read it when they settle: the stored zone may be what changed, so the cached settings are refetched
 * with the day, and the next edit sends the new zone.
 * @param error - The error the mutation failed with, or null when it succeeded.
 * @returns true only for a CONFLICT carrying `data.reason === 'day-changed'`
 * @example isDayChangedRefusal(new ORPCError('CONFLICT', { data: REFUSAL.dayChanged })) // true
 */
export function isDayChangedRefusal(error: unknown): boolean {
  return (
    error instanceof ORPCError &&
    error.code === 'CONFLICT' &&
    refusalReason(error) === REFUSAL.dayChanged.reason
  )
}

// A refusal's machine-readable reason (its `data`, one of {@link REFUSAL}), or null for any other error.
function refusalReason(error: unknown): RefusalReason | null {
  if (!(error instanceof ORPCError)) return null
  return refusalDataSchema.safeParse(error.data).data?.reason ?? null
}

/** What the correction sheet's status line says for each refusal reason the API sends; the pen file's 状態行 board lists them. */
const REFUSAL_MESSAGES = {
  'day-changed': '別の端末で記録が変わったため、最新の状態を表示しました',
  'record-changed':
    '別の端末でこの記録が変わったため、最新の状態を表示しました',
  archived: 'アーカイブ済みの活動になるため、変更できません',
  'no-room': 'これ以上動かせません',
  'no-neighbour': '統合できる記録がありません',
  'next-on-later-day': '次の記録は翌日なので統合できません',
  'cannot-split': 'ここでは分割できません',
  busy: '処理が混み合っています。少し待ってからもう一度お試しください',
} as const satisfies Record<RefusalReason, string>

/**
 * The status line after a call that gave no answer in time. The write may still have landed, even after the list was read
 * again (its transaction can commit late, and a hung API fails the refetch too), so the line asks the user to check the rows
 * rather than claiming they are current.
 */
const TIMEOUT_MESSAGE =
  '応答がありませんでした。反映されたか一覧で確かめてください'

/** The status line after any other failure (offline mid-request, a server error). */
const FAILED_MESSAGE = '保存できませんでした。もう一度お試しください'

/**
 * The status line's text for a failed edit or 「元に戻す」. Every mutation of the sheet calls it from its `onError`, so no
 * failure is silent: before, the buttons re-enabled and nothing said why.
 * @param error - The error the mutation failed with.
 * @returns
 * - the reason's message ({@link REFUSAL_MESSAGES}) when the API sent one
 * - the record-changed message for NOT_FOUND (the record is gone, merged away on another device)
 * - {@link TIMEOUT_MESSAGE} for a {@link RequestTimeoutError}
 * - {@link FAILED_MESSAGE} for anything else
 * @example refusalMessage(new ORPCError('CONFLICT', { data: REFUSAL.nextOnLaterDay })) // '次の記録は翌日なので統合できません'
 */
export function refusalMessage(error: unknown): string {
  if (error instanceof RequestTimeoutError) return TIMEOUT_MESSAGE
  const reason = refusalReason(error)
  if (reason) return REFUSAL_MESSAGES[reason]
  if (error instanceof ORPCError && error.code === 'NOT_FOUND')
    return REFUSAL_MESSAGES['record-changed']
  return FAILED_MESSAGE
}

/** The status line shown under the sheet's rows: a refusal to read (`alert`), or why the panel waits (`quiet`). */
export type SheetStatus = { tone: 'alert' | 'quiet'; text: string }

/** The status line while the panel waits for a write that has not landed. */
const WRITING_MESSAGE = '反映しています…'

/** How long a write must be in flight before the status line says so: one that lands at once shows nothing. */
export const WRITING_LINE_DELAY_MS = 400

/** The status line while a write waits for the connection (web only: native never reports offline). */
const OFFLINE_MESSAGE = 'オフラインです。接続が戻ると反映されます'

/**
 * What the sheet's status line says: the last refusal wins, then why the panel is dim, else nothing (the line takes no
 * height). Offline is read from the connection, not from a mutation's `isPaused`: a tap queued behind another in its scope
 * is paused while online, and a refetch after a landed write pauses offline while its mutation reads as running.
 * @param facts.refusal - The last failure's message ({@link refusalMessage}), until the next press, selection or undo.
 * @param facts.waiting - Whether a `switches.*` or `settings.*` write has been in flight for {@link WRITING_LINE_DELAY_MS}
 * (its refetch included, since `onSettled` awaits it). A refetch alone dims the panel without a line.
 * @param facts.online - TanStack's `onlineManager` state.
 * @returns the line to show, or null when there is nothing to say
 * @example statusLine({ refusal: null, waiting: true, online: false }) // { tone: 'quiet', text: OFFLINE_MESSAGE }
 */
export function statusLine(facts: {
  refusal: string | null
  waiting: boolean
  online: boolean
}): SheetStatus | null {
  if (facts.refusal) return { tone: 'alert', text: facts.refusal }
  if (!facts.waiting) return null
  return {
    tone: 'quiet',
    text: facts.online ? WRITING_MESSAGE : OFFLINE_MESSAGE,
  }
}

/**
 * Which archived-activity box the carried-in panel shows above the picker: the warning while the record holds an archived
 * activity (a pick cannot be undone), the notice after such a pick or a refused undo, until the next edit or selection.
 * @param row - The selected row.
 * @param noticeId - The row the notice was raised for, or null once cleared.
 * @returns 'notice', 'warning', or null on the day's own rows and when neither applies.
 * @example archivedBox(carriedIn, carriedIn.id) // 'notice'
 */
export function archivedBox(
  row: CorrectionRow,
  noticeId: string | null,
): 'warning' | 'notice' | null {
  if (!row.carriedIn) return null
  if (noticeId === row.id) return 'notice'
  return row.archived ? 'warning' : null
}

/**
 * The `changeActivity` input for a pick: on the carried-in record it carries the `revision` the sheet listed, so a stale
 * sheet is refused rather than overwriting another device's change on an earlier day; the day's own rows carry the day's
 * baseline instead, which their day undo relies on.
 * @param row - The row picked on.
 * @param activityId - The picked activity, null for detox.
 * @param baseline - The day as the sheet listed it ({@link dayBaseline}).
 * @returns The input, with `revision` on a carried-in row and `baseline` on the day's own rows.
 * @example pickRequest(carriedIn, 'sleep', baseline) // { id: 'w', activityId: 'sleep', revision: 3 }
 */
export function pickRequest(
  row: CorrectionRow,
  activityId: string | null,
  baseline: DayBaseline | undefined,
): ChangeActivityInput {
  return row.carriedIn
    ? { id: row.id, activityId, revision: row.revision }
    : { id: row.id, activityId, baseline }
}

/**
 * The scroll offset that brings a selected card fully into the sheet's view with the least movement (a card taller than the
 * view shows its header at the top); the sheet calls it after the card lays out.
 * @param card - The card's top and height inside the scroll content.
 * @param viewport - The current offset and the visible height.
 * @returns The new offset, or null when the card is already fully visible.
 * @example revealOffset({ top: 700, height: 300 }, { scrollY: 200, viewportHeight: 600 }) // 400
 */
export function revealOffset(
  card: { top: number; height: number },
  viewport: { scrollY: number; viewportHeight: number },
): number | null {
  const bottom = card.top + card.height
  const viewBottom = viewport.scrollY + viewport.viewportHeight
  if (card.top >= viewport.scrollY && bottom <= viewBottom) return null
  // Above the view, or too tall to fit: the header goes to the top.
  if (card.top < viewport.scrollY || card.height > viewport.viewportHeight)
    return card.top
  return bottom - viewport.viewportHeight
}

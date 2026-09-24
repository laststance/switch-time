import { ORPCError } from '@orpc/client'
import type { AppRouterClient } from '@switch-time/api'
import {
  ARCHIVED_REFUSAL,
  clampStart,
  localDay,
  MIN_SEGMENT_MS,
  type ReplaceDayInput,
} from '@switch-time/shared'

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
  return (
    timeline
      .map((row, index) =>
        describeRow(
          row,
          timeline[index - 1] ?? null,
          timeline[index + 1] ?? null,
          row.activityId === null ? DETOX_ROW : byId.get(row.activityId),
          bounds,
        ),
      )
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

// One row's texts and flags; `prev`/`next` are its neighbours in the whole timeline (the carried states included).
function describeRow(
  row: SwitchRow,
  prev: SwitchRow | null,
  next: SwitchRow | null,
  activity: CorrectionActivity = UNKNOWN,
  bounds: DayBounds,
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
    ...(carriedIn ? LOCKED : ownRowFlags(row, prev, next, bounds)),
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
): RowFlags {
  const startedAt = row.startedAt.getTime()
  const trueEnd = next?.startedAt.getTime() ?? bounds.now
  const midpoint = Math.floor((startedAt + trueEnd) / 2)
  return {
    canMoveEarlier: moveTarget(row, prev, next, bounds, -15) !== null,
    canMoveLater: moveTarget(row, prev, next, bounds, 15) !== null,
    canMergePrevious: prev !== null,
    // Merging moves the next row back to this row's start, so that row must be the day's own: 「元に戻す」 rewrites this day
    // only, and would drop the next day's first switch for good.
    canMergeNext: next !== null && trueEnd < bounds.end,
    // Both halves keep the clamp's margin and the new row stays inside the day.
    canSplit: midpoint - startedAt >= MIN_SEGMENT_MS && midpoint < bounds.end,
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

/** The four 区切る時刻 steps in minutes of elapsed time (like 開始時刻's ±15), in button order. */
export const CUT_STEPS = [-60, -15, 15, 60] as const
export type CutStepMinutes = (typeof CUT_STEPS)[number]
/** The time the user stepped 区切る時刻 to, and on which row; the panel keeps it in local state. */
export type ChosenCut = { id: string; at: number }
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
 * What 「元に戻す」 holds. `day`: the day's rows before the edit, written back through `switches.replaceDay`; `reselectId` is
 * the carried-in row a cut came from, selected again once the undo lands. `activity`: a pick on the carried-in record, put
 * back through `switches.changeActivity` only while the record still holds `from`, since that record reaches another day.
 */
export type UndoSlot =
  | { kind: 'day'; day: string; rows: DaySnapshot; reselectId: string | null }
  | {
      kind: 'activity'
      day: string
      id: string
      from: string | null
      to: string | null
    }
/** The sheet's edits, as far as the undo cares: `cut` is 「ここで分割」 on a carried-in row, `split` is 半分で分割. */
export type CorrectionEdit =
  | { kind: 'move' | 'merge' | 'split' | 'cut' }
  | { kind: 'pick'; activityId: string | null }

/**
 * The undo an edit arms once it succeeds, from the rows as they were when the button was pressed. A pick on the carried-in
 * record arms an activity undo, or nothing when its activity is archived (the picker cannot offer it back, and an older undo
 * must not replay either); every other edit arms the day undo.
 * @param edit - The edit just made.
 * @param row - The row it was made on, before the edit.
 * @param day - The sheet's day.
 * @param list - The `switches.listByDay` answer before the edit.
 * @returns
 * - A carried-in pick: `{ kind: 'activity', … }`, or `{ blocked: 'archived' }`
 * - Anything else: `{ kind: 'day', … }`, remembering the carried-in row after a cut
 * @example undoSlotFor({ kind: 'pick', activityId: 'sleep' }, carriedIn, '2026-09-08', list) // { kind: 'activity', id, from: 'sleep', to: 'work', … }
 */
export function undoSlotFor(
  edit: CorrectionEdit,
  row: CorrectionRow,
  day: string,
  list: ListedDay,
): UndoSlot | { blocked: 'archived' } {
  if (edit.kind === 'pick' && row.carriedIn) {
    if (row.archived) return { blocked: 'archived' }
    return {
      kind: 'activity',
      day,
      id: row.id,
      from: edit.activityId,
      to: row.activityId,
    }
  }
  return {
    kind: 'day',
    day,
    rows: daySnapshot(list),
    reselectId: edit.kind === 'cut' ? row.id : null,
  }
}

/** `switches.changeActivity`'s input; `from` makes the write conditional on what the record holds. */
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
 * The call behind 「元に戻す」 for the armed slot: the day's rows back through `replaceDay`, or the carried-in record's
 * previous activity through `changeActivity`, conditional on the record still holding the pick.
 * @param slot - The armed undo.
 * @returns The procedure and its input; a day undo also names the row to select after it (the carried-in row a cut came from).
 * @example undoRequest({ kind: 'activity', day, id: 'w', from: 'sleep', to: 'work' }) // { procedure: 'changeActivity', input: { id: 'w', activityId: 'work', from: 'sleep' } }
 */
export function undoRequest(slot: UndoSlot): UndoRequest {
  if (slot.kind === 'day')
    return {
      procedure: 'replaceDay',
      input: { day: slot.day, rows: slot.rows },
      reselectId: slot.reselectId,
    }
  return {
    procedure: 'changeActivity',
    input: { id: slot.id, activityId: slot.to, from: slot.from },
  }
}

/**
 * What a failed activity undo does to 「元に戻す」: an answer that can never succeed turns it off (the record changed
 * elsewhere or is gone, silently; the previous activity was archived, with the notice), and a passing failure (network,
 * server error, an expired sign-in) keeps it for another try, as the day undo does.
 * @param error - The error the undo's mutation failed with.
 * @returns
 * - 'clear': CONFLICT or NOT_FOUND
 * - 'archived': BAD_REQUEST with `data.reason === 'archived'` (`changeActivity` refuses an archived target)
 * - 'keep': anything else, another BAD_REQUEST included
 * @example afterUndoFailure(new ORPCError('CONFLICT')) // 'clear'
 */
export function afterUndoFailure(
  error: unknown,
): 'keep' | 'clear' | 'archived' {
  if (!(error instanceof ORPCError)) return 'keep'
  if (error.code === 'CONFLICT' || error.code === 'NOT_FOUND') return 'clear'
  return error.code === 'BAD_REQUEST' && isArchivedRefusal(error.data)
    ? 'archived'
    : 'keep'
}

// The archived refusal's marker ({@link ARCHIVED_REFUSAL}) from `switches.changeActivity`; any other BAD_REQUEST is a plain failure.
function isArchivedRefusal(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'reason' in data &&
    data.reason === ARCHIVED_REFUSAL.reason
  )
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
 * The `changeActivity` input for a pick: on the carried-in record it carries `from`, the activity the sheet shows, so a
 * stale sheet is refused rather than overwriting another device's change on an earlier day; the day's own rows keep the
 * unconditional write their day undo relies on.
 * @param row - The row picked on.
 * @param activityId - The picked activity, null for detox.
 * @returns The input, with `from` only on a carried-in row.
 * @example pickRequest(carriedIn, 'sleep') // { id: 'w', activityId: 'sleep', from: 'work' }
 */
export function pickRequest(
  row: CorrectionRow,
  activityId: string | null,
): ChangeActivityInput {
  return row.carriedIn
    ? { id: row.id, activityId, from: row.activityId }
    : { id: row.id, activityId }
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

import { ORPCError } from '@orpc/client'
import type { AppRouterClient } from '@switch-time/api'
import {
  DAY_ROWS_MAX,
  clampStart,
  dayDigest,
  daySchema,
  LIVE_ACTIVITIES_MAX,
  localDay,
  MIN_SEGMENT_MS,
  REFUSAL,
  refusalDataSchema,
  UNDO_ROWS_MAX,
  type DayBaseline,
  type DayRow,
  type ExcludedReason,
  type RefusalReason,
  type ReplaceDayInput,
} from '@switch-time/shared'
import type { QueryState } from '@tanstack/react-query'
import { z } from 'zod'

import { DETOX } from './detox'
import {
  formatDay,
  formatDuration,
  formatMonthDay,
  formatSpokenDuration,
  formatTime,
  spokenActivityNames,
} from './format'
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
/**
 * Where 「ここで分割」 may cut a row, in epoch ms on the stored zone's quarter hours; `initial` is where 区切る時刻 opens.
 * `middleMinute`: no quarter hour fits, so the range is the one whole minute in the row's middle (min = max = initial).
 * `earliest` – `latest`: every whole minute `switches.splitAt` takes, so a time already on the readout stays while it
 * is still one of them, even once today's clock moves the range (a middle minute, then quarter hours).
 * `nowBound`: the range ends a quarter short of now (the clock-skew margin), not at the record's end or 24:00, so a middle
 * minute sits near the record's start rather than in its middle.
 */
export type CutRange = {
  min: number
  max: number
  initial: number
  middleMinute: boolean
  nowBound: boolean
  earliest: number
  latest: number
}

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
  /**
   * What a screen reader says for the row's header instead of its visible texts: `仕事 9:00 – 18:00 9時間`, the name told apart
   * from detox and from the other activities ({@link spokenActivityNames}) and the length spoken ({@link formatSpokenDuration}).
   */
  label: string
  /** The record started before the day (listed last): its panel cuts it or changes its activity, and never moves or merges it. */
  carriedIn: boolean
  /** `9月23日〜9月25日`, every day the record reaches, from the day it started to the day it ends (today while it runs), each
   * with its year when that is not the viewed day's (the scope note names whose totals a pick changes); empty on the day's own rows. */
  trueReach: string
  /** `9月23日 23:00`, the record's real start with its date, and its year when that is not the viewed day's (the carried-in
   * panel's origin note); empty on the day's own rows. */
  trueStartLabel: string
  /** The row's activity was archived since: the picker cannot offer it back (the carried-in panel's warning). */
  archived: boolean
  /** The whole record, the part before the day included, as the idle rule measures it: its real start, and the next switch or now. */
  trueStart: number
  trueEnd: number
  /** 区切る時刻's range; null when no whole minute keeps a minute from both ends (「ここで分割」 is disabled). */
  cut: CutRange | null
  canMoveEarlier: boolean
  canMoveLater: boolean
  canMergePrevious: boolean
  canMergeNext: boolean
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
  const spokenNames = spokenActivityNames(activities)
  // The detox row keeps its own name: the escape is there so that no activity reads like it.
  const spokenNameOf = (row: SwitchRow) =>
    row.activityId === null
      ? DETOX_ROW.name
      : (spokenNames.get(row.activityId) ?? UNKNOWN.name)
  return (
    timeline
      .map((row, index) => {
        const prev = timeline[index - 1] ?? null
        return describeRow(
          row,
          prev,
          timeline[index + 1] ?? null,
          activityOf(row),
          spokenNameOf(row),
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
const MINUTE_MS = 60_000
// How far a device clock may run ahead of the server's before 区切る時刻 would offer a cut `switches.splitAt` refuses.
const CLOCK_SKEW_MARGIN_MS = 15 * 60_000

/**
 * 区切る時刻's range for a record from `startedAt` to `trueEnd`, the carried-in record's or one of the day's own rows: quarter
 * hours of the viewed day (counted from its 0:00, so any zone offset works) that keep a minute from the record's true start
 * and from its end, as `switches.splitAt` checks, and stay a quarter short of now so a device clock running fast cannot offer
 * a cut the server refuses. 0:00 itself is allowed, since midnight is not a switch. The opening value is the middle quarter,
 * a tie rounding down. A row too short for any quarter hour is cut at its middle whole minute instead, so a row of a few
 * minutes can still be cut. Called by {@link describeRow} for every row, on every tick.
 * @param startedAt - The record's true start (before the day for the carried-in record).
 * @param trueEnd - The next switch, or now for the current state.
 * @param bounds - The viewed day and the clock.
 * @returns
 * - the quarter hours in reach, opening at the middle one
 * - `middleMinute`: the one whole minute in the middle, when no quarter hour fits
 * - null when not even a whole minute keeps a minute from both ends (a fresh current state: until 17 min past its start)
 * - `nowBound`: whether the quarter short of now set the range's end
 * @example cutRange(nineSevenTwentyTwo, nineEightSeven, bounds) // { min: 0:00, max: 6:45, initial: 3:15, middleMinute: false, nowBound: false, earliest: 0:00, latest: 6:59 }
 * @example cutRange(nineOhOne, nineFourteen, bounds) // { min: 9:07, max: 9:07, initial: 9:07, middleMinute: true, nowBound: false, earliest: 9:02, latest: 9:13 }
 */
function cutRange(
  startedAt: number,
  trueEnd: number,
  bounds: DayBounds,
): CutRange | null {
  const floor = Math.max(startedAt + MIN_SEGMENT_MS, bounds.start)
  const recordEnd = Math.min(trueEnd, bounds.end)
  const nowLimit = bounds.now - CLOCK_SKEW_MARGIN_MS
  const ceiling = Math.min(recordEnd, nowLimit) - MIN_SEGMENT_MS
  const stepsInside = (step: number) => ({
    first: bounds.start + Math.ceil((floor - bounds.start) / step) * step,
    last: bounds.start + Math.floor((ceiling - bounds.start) / step) * step,
  })
  const minutes = stepsInside(MINUTE_MS)
  // Not even a whole minute keeps a minute from both ends: 「ここで分割」 is disabled.
  if (minutes.first > minutes.last) return null
  const reach = {
    nowBound: nowLimit < recordEnd,
    earliest: minutes.first,
    latest: minutes.last,
  }
  const quarters = stepsInside(QUARTER_MS)
  if (quarters.first <= quarters.last) {
    const count = (quarters.last - quarters.first) / QUARTER_MS
    return {
      min: quarters.first,
      max: quarters.last,
      initial: quarters.first + Math.floor(count / 2) * QUARTER_MS,
      middleMinute: false,
      ...reach,
    }
  }
  const middle =
    minutes.first +
    Math.floor((minutes.last - minutes.first) / MINUTE_MS / 2) * MINUTE_MS
  return {
    min: middle,
    max: middle,
    initial: middle,
    middleMinute: true,
    ...reach,
  }
}

const NO_TRUE_START = { trueReach: '', trueStartLabel: '' }

/**
 * A carried-in row's origin and reach: the day it really started with its time, and every day from there to the day its
 * record ends (the day holding its last minute, today while it runs), each date with its year when that is not the viewed
 * day's. Only carried-in rows pay for these formats per tick; called by {@link describeRow}.
 * @param startedAt - The record's real start, before the viewed day.
 * @param trueEnd - The next switch, or now.
 * @param bounds - The viewed day and the stored zone.
 * @returns `trueStartLabel` (`9月21日 23:00`) and `trueReach` (`9月21日〜9月24日`).
 * @example trueStartLabels(new Date('2025-12-28T14:00:00Z'), jan1SixThirty, jan1Bounds) // { trueStartLabel: '2025年12月28日 23:00', trueReach: '2025年12月28日〜1月1日' }
 */
function trueStartLabels(
  startedAt: Date,
  trueEnd: number,
  bounds: DayBounds,
): Pick<CorrectionRow, 'trueReach' | 'trueStartLabel'> {
  const { timeZone } = bounds
  const viewedDay = localDay(new Date(bounds.start), timeZone)
  const startDay = formatMonthDay(localDay(startedAt, timeZone), viewedDay)
  const lastDay = formatMonthDay(
    localDay(new Date(trueEnd - 1), timeZone),
    viewedDay,
  )
  return {
    trueReach: `${startDay}〜${lastDay}`,
    trueStartLabel: `${startDay} ${formatTime(startedAt, timeZone)}`,
  }
}

// One row's texts and flags; `prev`/`next` are its neighbours in the whole timeline (the carried states included),
// `spokenName` is what its label reads for the activity, and `prevArchived` says whether the previous row's activity is archived.
function describeRow(
  row: SwitchRow,
  prev: SwitchRow | null,
  next: SwitchRow | null,
  activity: CorrectionActivity = UNKNOWN,
  spokenName: string,
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
  const range = `${startLabel} – ${endLabel(end, next, bounds)}`
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
    range,
    duration: formatDuration(end - start),
    label: `${spokenName} ${range} ${formatSpokenDuration(end - start)}`,
    carriedIn,
    ...(carriedIn
      ? trueStartLabels(row.startedAt, trueEnd, bounds)
      : NO_TRUE_START),
    archived: Boolean(activity.archivedAt),
    trueStart: startedAt,
    trueEnd,
    cut: cutRange(startedAt, trueEnd, bounds),
    ...(carriedIn
      ? LOCKED
      : ownRowFlags(row, prev, next, bounds, prevArchived)),
  }
}

type RowFlags = Pick<
  CorrectionRow,
  'canMoveEarlier' | 'canMoveLater' | 'canMergePrevious' | 'canMergeNext'
>
// Moving or merging the carried-in record would rewrite the earlier day, which 「元に戻す」 cannot restore.
const LOCKED: RowFlags = {
  canMoveEarlier: false,
  canMoveLater: false,
  canMergePrevious: false,
  canMergeNext: false,
}

// The action panel's flags for one of the day's own rows, with the clamp the API applies and the day's floor and ceiling.
function ownRowFlags(
  row: SwitchRow,
  prev: SwitchRow | null,
  next: SwitchRow | null,
  bounds: DayBounds,
  prevArchived: boolean,
): RowFlags {
  const trueEnd = next?.startedAt.getTime() ?? bounds.now
  return {
    canMoveEarlier: moveTarget(row, prev, next, bounds, -15) !== null,
    canMoveLater: moveTarget(row, prev, next, bounds, 15) !== null,
    // Merging the running record makes the previous one the current state, which the API refuses for an archived activity.
    canMergePrevious: prev !== null && (next !== null || !prevArchived),
    // Merging moves the next row back to this row's start, so that row must be the day's own: 「元に戻す」 rewrites this day
    // only, and would drop the next day's first switch for good.
    canMergeNext: next !== null && trueEnd < bounds.end,
  }
}

/**
 * The rows 「元に戻す」 writes back through `switches.replaceDay`: the day's own rows only, never the carried-in state.
 * @example const previous = daySnapshot(baseline.rows)
 */
export function daySnapshot(
  rows: readonly Pick<DayRow, 'activityId' | 'startedAt' | 'startsRun'>[],
): DaySnapshot {
  return rows.map(({ activityId, startedAt, startsRun }) => ({
    activityId,
    startedAt,
    ...runMark(startsRun),
  }))
}

// A detox re-tap's mark, and nothing for any other row: written back as a plain detox row, a re-tap would fold its run into
// the one before it, and leaving the mark off every other row keeps the baseline and the undo as small as before.
const runMark = (startsRun: boolean | undefined) =>
  startsRun ? { startsRun } : {}

// A row as a baseline or 「元に戻す」's `expected` compares it (id, activity, start and revision), with the re-tap mark the
// undo writes back.
const listedRow = ({
  id,
  activityId,
  startedAt,
  revision,
  startsRun,
}: Pick<
  SwitchRow,
  'id' | 'activityId' | 'startedAt' | 'revision' | 'startsRun'
>): DayRow => ({
  id,
  activityId,
  startedAt,
  revision,
  ...runMark(startsRun),
})

/**
 * The day as the sheet listed it, sent with every edit the day undo covers: the API refuses the edit unless the day still
 * reads exactly so under the same stored zone, which makes the list the day's true state before the edit. On a day busier
 * than {@link DAY_ROWS_MAX} it sends the rows' {@link dayDigest} instead of the rows, so the request stays small.
 * @param day - The sheet's day.
 * @param timeZone - The stored zone the list was windowed in.
 * @param list - The `switches.listByDay` answer the button was pressed on.
 * @returns The baseline: the day's own rows with their ids and revisions, oldest first (on a busy day, their digest), the
 *   carried-in record with its revision and the first switch after the day (null: none).
 * @example dayBaseline('2026-09-08', 'Asia/Tokyo', list) // { day, timeZone, rows: [{ id, activityId, startedAt, revision }, …], carriedIn: { id: 'c', revision: 2 }, carriedOutId: 'n' }
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
  if (list.rows.length > DAY_ROWS_MAX)
    return { ...sides, digest: dayDigest(list.rows) }
  return { ...sides, rows: list.rows.map(listedRow) }
}

/**
 * The day as the sheet listed it when an edit's button was pressed: the baseline the edit sends ({@link dayBaseline}), and
 * every listed row, which a busy day's baseline leaves out but its 「元に戻す」 still writes back ({@link undoSlotFor}).
 */
export type PressedDay = { baseline: DayBaseline; rows: DayRow[] }

/**
 * {@link PressedDay} for the list the button was pressed on. Called by the sheet's edits at the press.
 * @example pressedDay('2026-09-08', 'Asia/Tokyo', list) // { baseline: dayBaseline(…), rows: [{ id, activityId, startedAt, revision }, …] }
 */
export function pressedDay(
  day: string,
  timeZone: string,
  list: ListedDay,
): PressedDay {
  return {
    baseline: dayBaseline(day, timeZone, list),
    rows: list.rows.map(listedRow),
  }
}

/**
 * The row whose span an edit changed without the API returning it, which the write moved one revision on: a ±15分 move's
 * previous row (it now ends elsewhere; none when the edited row is the day's first, whose previous is the carried-in
 * record) and a cut's row (it now ends at the cut; not a day row when the cut was of the carried-in record).
 * @returns The row's id, or null when the edit changed only the row it returned
 * @example bumpedRowId([work, rest], 'move', rest.id) // work.id
 */
function bumpedRowId(
  before: readonly DayRow[],
  kind: CorrectionEdit['kind'],
  editedId: string,
): string | null {
  if (kind === 'cut') return editedId
  if (kind !== 'move') return null
  const index = before.findIndex((row) => row.id === editedId)
  return index > 0 ? (before[index - 1]?.id ?? null) : null
}

// A row one revision on, as the API's write left it; a row listed without one (never, since listByDay names it) stays so.
const bumped = (row: DayRow): DayRow =>
  row.revision === undefined ? row : { ...row, revision: row.revision + 1 }

/**
 * The day's own rows once an edit has landed, from the baseline the API checked and the row the edit returned: the edit
 * wrote nothing else, since the API ran it under the user's lock right after that check. A merge deletes the edited row;
 * the returned row (moved, re-activitied, the merge's kept neighbour, a cut's new part) replaces its id or joins; rows
 * outside the day drop (a merge into the carried-in record keeps that record on its own day); the row the write reshaped
 * without returning it moves one revision on ({@link bumpedRowId}). 「元に戻す」 sends these as `expected`, so it is refused
 * once anything else has touched the day, even a change changed back.
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
  const bumpedId = bumpedRowId(before, edit.kind, editedId)
  const untouched = before
    .filter(
      (row) =>
        row.id !== returned.id &&
        !(edit.kind === 'merge' && row.id === editedId),
    )
    .map((row) => (row.id === bumpedId ? bumped(row) : row))
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
 * The cut time a row's panel opens with: the range's middle as it is when the panel mounts, kept as a choice so
 * today's clock, which moves the range's end and so its middle, never shifts the time under the user's finger.
 * @param row - The row the panel opens on.
 * @returns The row's `initial` as a {@link ChosenCut}, or null when the row has no cut range.
 * @example openedCut(carriedIn) // { id: 'w', at: 3:15 }
 */
export function openedCut(row: CorrectionRow): ChosenCut | null {
  return row.cut ? { id: row.id, at: row.cut.initial } : null
}

/**
 * The choice a cut panel should hold so the readout never follows today's clock: what the stepper shows, whenever the kept
 * choice is not already that (a row that had no cut when its panel opened, or a choice a cut or an undo left outside). Never
 * while a write or a read is pending, so a refused cut, whose rows land after the refusal, leaves the user's time.
 * Called by the panel's cut group at every render, which stores the answer.
 * @param row - The selected row.
 * @param chosen - The choice the panel holds now.
 * @param shown - The stepper drawn from them ({@link cutStepper}).
 * @param pending - A write or the day's read is in flight.
 * @returns
 * - The time on the readout as a {@link ChosenCut}, when the panel holds another or none and nothing is pending
 * - null when the panel already holds it, the row has no cut, or something is pending
 * @example cutToHold(carriedIn, null, cutStepper(carriedIn, null, TZ), false) // { id: 'w', at: 3:15 }
 * @example cutToHold(carriedIn, null, cutStepper(carriedIn, null, TZ), true) // null
 */
export function cutToHold(
  row: CorrectionRow,
  chosen: ChosenCut | null,
  shown: CutStepper,
  pending: boolean,
): ChosenCut | null {
  if (pending || shown.at === null || shown.at === chosen?.at) return null
  return { id: row.id, at: shown.at }
}

/** What the 区切る時刻 group reads out: the time on the readout and the notes under it. */
export type CutView = { label: string; notes: readonly string[] }

/**
 * What the 区切る時刻 group shows while 「ここで分割」 lands: the view it last showed stays until the write and the day's
 * read settle, so the rows and totals that land one after the other never move the readout or its notes mid-answer.
 * Called by the panel's cut group at every render, which stores `hold` when it is not null.
 * @param held - The view the group showed last, or null before its first render.
 * @param live - The view drawn from the current rows and totals.
 * @param pending - A write or the day's read is in flight.
 * @returns
 * - `shown`: `held` while pending (or `live` before any was held), else `live`
 * - `hold`: `live` when idle and it differs from `held`, else null, so the stored state changes only when the view does
 * @example cutViewShown({ label: '3:15', notes: [] }, { label: '9:07', notes: [] }, true) // { shown: { label: '3:15', … }, hold: null }
 * @example cutViewShown({ label: '3:15', notes: [] }, { label: '9:07', notes: [] }, false) // { shown: { label: '9:07', … }, hold: { label: '9:07', … } }
 */
export function cutViewShown(
  held: CutView | null,
  live: CutView,
  pending: boolean,
): { shown: CutView; hold: CutView | null } {
  // While pending the held view stays; before anything was held, the live one is all there is.
  if (pending) return { shown: held ?? live, hold: null }
  return { shown: live, hold: sameCutView(held, live) ? null : live }
}

// Whether two views read the same, so an idle render stores nothing and never loops.
const sameCutView = (held: CutView | null, live: CutView): boolean =>
  held !== null &&
  held.label === live.label &&
  held.notes.length === live.notes.length &&
  held.notes.every((note, index) => note === live.notes[index])

/** What the 区切る時刻 row draws: the cut time (null = no cut), its readout, and where each step lands (null = disabled). */
export type CutStepper = {
  at: number | null
  label: string
  targets: Record<CutStepMinutes, number | null>
}

/**
 * The 区切る時刻 stepper of the selected row: a chosen time stays while `splitAt` still takes it (`earliest` – `latest`, so
 * today's clock never moves it), and anything else (another row's choice, a time a cut or an undo left outside) opens at
 * `initial`. Steps land on the range's quarter hours, clamped to it; a step that cannot move its way is disabled, and so
 * is every step on a middle-minute row. Read by either panel's cut group at every render.
 * @param row - The selected row.
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
  // No cut at all: the readout says so and every step is disabled.
  if (!cut)
    return {
      at: null,
      label: '—',
      targets: { [-60]: null, [-15]: null, [15]: null, [60]: null },
    }
  const kept =
    chosen?.id === row.id &&
    chosen.at >= cut.earliest &&
    chosen.at <= cut.latest
  const at = kept ? chosen.at : cut.initial
  const step = (minutes: CutStepMinutes): number | null => {
    // A middle-minute row cuts only at its one minute.
    if (cut.middleMinute) return null
    // Round toward `at` onto the quarter hours, so a kept minute off them (a middle minute before the clock made room for
    // a quarter) steps onto the grid.
    const quarters = (at + minutes * MINUTE_MS - cut.min) / QUARTER_MS
    const onGrid =
      cut.min +
      (minutes > 0 ? Math.floor(quarters) : Math.ceil(quarters)) * QUARTER_MS
    const target = Math.min(Math.max(onGrid, cut.min), cut.max)
    const movesItsWay = minutes > 0 ? target > at : target < at
    return movesItsWay ? target : null
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

/** The day facts the cut's effect on the totals depends on; the hook reads them from settings and the viewed day's stats. */
export type TotalsFacts = {
  idleThresholdMs: number
  /**
   * A past day's class as `stats.day` reports it ({@link noteDayClass}); null when the day is today or has a switch of its
   * own, undefined while no answer can be trusted, so the 計測 note waits rather than guess.
   */
  dayExcluded: ExcludedReason | null | undefined
}

/**
 * The viewed day's class for {@link TotalsFacts}, from the `stats.day` query the correction hook runs for a past day
 * only, checked against the day's own list; kept out of the hook so each answer is tested.
 * @param day - Whether the viewed day is before today in the stored zone, and whether its list shows a switch of its own.
 * @param query - The `stats.day` query: its last answer (undefined until one lands), whether its last fetch failed and
 *   whether a fetch waits for the network.
 * @returns
 * - null for today (never 計測なし yet, so never asked) and for a day with a switch of its own, which is measured
 *   whatever an older answer says: a cut's new row lands in the list before, or without, the stats refetch
 * - undefined while no answer has landed, or after a failed or paused fetch, whose kept answer may predate the day's rows
 * - otherwise the last answer, kept while a refetch runs so the line does not blink on every focus refetch
 * @example noteDayClass({ isPast: true, hasOwnRows: false }, { isError: false, isPaused: false, data: { days: [{ excluded: 'auto_unused' }] } }) // 'auto_unused'
 * @example noteDayClass({ isPast: true, hasOwnRows: true }, { isError: false, isPaused: false, data: { days: [{ excluded: 'auto_unused' }] } }) // null
 */
export function noteDayClass(
  day: { isPast: boolean; hasOwnRows: boolean },
  query: {
    isError: boolean
    isPaused: boolean
    data: { days: readonly { excluded: ExcludedReason | null }[] } | undefined
  },
): TotalsFacts['dayExcluded'] {
  if (!day.isPast || day.hasOwnRows) return null
  if (query.isError || query.isPaused) return undefined
  return query.data?.days[0]?.excluded
}

/** 'idle': the cut turns idle time into counted time; 'unmeasured': the day becomes 計測できた日. */
export type TotalsEffect = 'idle' | 'unmeasured'

/**
 * Whether a cut at `at` takes time out of the idle count: the whole record is over the threshold, and at least one of
 * the two parts is not (`segmentsInRange` measures each part by its own length). Detox is never idle, so it has no effect.
 * @param row - The selected row, with the whole record's true start and end.
 * @param idleThresholdMs - The user's idle threshold.
 * @param at - The cut time, or null when the row has none.
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
 * How a cut would change the totals, one line each under 「ここで分割」: a record over the idle threshold counts nowhere
 * until a cut leaves a part under it ({@link cutFreesIdle}), on any row; and a day the server counts as unused
 * (`auto_unused`, see {@link classifyDay}) becomes 計測できた日 once a cut of the carried-in record gives it a switch of its
 * own (a day with an own row to cut is already measured).
 * @param row - The selected row.
 * @param facts - The idle threshold and the viewed day's class.
 * @param at - The stepper's cut time, or null when there is none.
 * @returns The effects in display order; empty when the cut changes nothing in the totals.
 * @example cutTotalsEffects(carriedIn, { idleThresholdMs: 43_200_000, dayExcluded: 'auto_unused' }, at) // ['idle', 'unmeasured']
 */
export function cutTotalsEffects(
  row: CorrectionRow,
  facts: TotalsFacts,
  at: number | null,
): TotalsEffect[] {
  const effects: TotalsEffect[] = []
  if (cutFreesIdle(row, facts.idleThresholdMs, at)) effects.push('idle')
  // Only the carried-in record can be what leaves the day without a switch of its own.
  if (!row.carriedIn) return effects
  // The server's class already folds in today, the day's own taps, a detox that still measures it, a manual exclusion
  // (which outranks a switch) and auto-exclusion being off; a class not loaded yet says nothing.
  if (facts.dayExcluded === 'auto_unused') effects.push('unmeasured')
  return effects
}

/**
 * The lines under 「ここで分割」: why the four steps are off when the row is cut at its middle minute, then one per way the
 * cut changes the totals ({@link cutTotalsEffects}); or the reason the cut is disabled when the row has none.
 * @param row - The selected row.
 * @param facts - The idle threshold and the viewed day's class ({@link TotalsFacts}).
 * @param at - The stepper's cut time, which decides whether a part leaves the idle count.
 * @returns The lines in display order; empty when there is nothing to say.
 * @example cutNotes(carriedIn, facts, at) // ['区切ると、無操作扱い（12時間超）だった時間が集計に入ります']
 * @example cutNotes(nineOhOneToFourteen, facts, at) // ['短い記録のため、真ん中で区切ります']
 * @example cutNotes(runningSinceNineAtNineTwenty, facts, at) // ['直近15分は区切れないため、それより前の真ん中で区切ります']
 * @example cutNotes(freshCurrentState, facts, null) // ['区切れる時刻がありません']
 */
export function cutNotes(
  row: CorrectionRow,
  facts: TotalsFacts,
  at: number | null,
): string[] {
  if (!row.cut) return ['区切れる時刻がありません']
  const effects = cutTotalsEffects(row, facts, at).map((effect) =>
    effect === 'idle'
      ? `区切ると、無操作扱い（${idleLabel(facts.idleThresholdMs / 60_000)}超）だった時間が集計に入ります`
      : '区切ると、この日は計測できた日になります',
  )
  return row.cut.middleMinute ? [middleNote(row.cut), ...effects] : effects
}

// Why the row is cut at a middle minute: the record is short, or the quarter short of now leaves only its first minutes.
const middleNote = (cut: CutRange): string =>
  cut.nowBound
    ? '直近15分は区切れないため、それより前の真ん中で区切ります'
    : '短い記録のため、真ん中で区切ります'

/**
 * What 「元に戻す」 holds. `day`: the day's rows before the edit, written back through `switches.replaceDay` only while the
 * stored zone is still `timeZone`, the day still holds exactly `expected`, the rows the edit left, and its last row still
 * runs into `carriedOutId` (an edit on the day never changes it, so it is the baseline's); `reselect` is the row to
 * select again once the undo lands ({@link Reselect}); `account` is the user the edit was written as (the returned row's
 * `userId`, what the cookie said, not what this tab believed), so `replaceDay` refuses the undo from any other session: a
 * detox-only snapshot of an empty day passes every other check. `activity`: a pick on the carried-in record, put back
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
      reselect: Reselect
      account: string
    }
  | {
      kind: 'activity'
      day: string
      id: string
      to: string | null
      revision: number
    }
/**
 * The row a day undo selects once it lands. A cut of the carried-in record names it by id: that record starts before the
 * day, so `switches.replaceDay` leaves it alone. A cut of one of the day's own rows names it by its start (epoch ms):
 * `replaceDay` deletes the day's rows and writes them back under new ids, so only the start finds it again. null: nothing
 * to select.
 */
export type Reselect = { id: string } | { startedAt: number } | null

/**
 * The sheet's edits, as far as the undo cares, with the row the procedure returned: `cut` is 「ここで分割」 on any row. A
 * pick's returned row carries the revision its write left.
 */
export type CorrectionEdit = {
  kind: 'move' | 'pick' | 'merge' | 'cut'
  returned: Pick<
    SwitchRow,
    'id' | 'activityId' | 'startedAt' | 'startsRun' | 'revision' | 'userId'
  >
}

/**
 * The undo an edit arms once it succeeds, from the rows as they were when the button was pressed (the baseline the API
 * checked). A pick on the carried-in record arms an activity undo, or nothing when its activity is archived (the picker
 * cannot offer it back, and an older undo must not replay either); every other edit arms the day undo, unless the day
 * listed more than {@link UNDO_ROWS_MAX} rows, more than one request carries back. Called by the sheet's edits once they
 * land.
 * @param edit - The edit just made and the row it returned.
 * @param row - The row it was made on, before the edit.
 * @param pressed - The day as the sheet listed it when the button was pressed; undefined before the day's list arrived.
 * @param window - The day's [start, end) in epoch ms.
 * @returns
 * - A carried-in pick: `{ kind: 'activity', … }`, or `{ blocked: 'archived' }`
 * - Anything else: `{ kind: 'day', … }` with the rows the edit left as `expected`, and the row to select after the undo
 * - null with no list or one over {@link UNDO_ROWS_MAX} rows: no undo, and the caller drops any older one
 * @example undoSlotFor({ kind: 'pick', returned }, carriedIn, pressedDay(day, tz, list), bounds) // { kind: 'activity', id, to: 'work', revision: 4, … }
 */
export function undoSlotFor(
  edit: CorrectionEdit,
  row: CorrectionRow,
  pressed: PressedDay | undefined,
  window: Pick<DayBounds, 'start' | 'end'>,
): UndoSlot | { blocked: 'archived' } | null {
  if (!pressed) return null
  const { baseline, rows } = pressed
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
  if (rows.length > UNDO_ROWS_MAX) return null
  return {
    kind: 'day',
    day: baseline.day,
    timeZone: baseline.timeZone,
    rows: daySnapshot(rows),
    expected: rowsAfterEdit(rows, edit, row.id, window),
    carriedOutId: baseline.carriedOutId,
    reselect: reselectAfterUndo(edit.kind, row),
    account: edit.returned.userId,
  }
}

/**
 * What a landed edit does to 「元に戻す」, from {@link undoSlotFor}'s answer. Called by the sheet's edits once they land.
 * @param next - {@link undoSlotFor}'s answer for the edit.
 * @returns
 * - `{ slot, archived: false }`: arm the slot
 * - `{ slot: null, archived: false }` for null: drop any older slot, which no longer matches the day
 * - `{ slot: null, archived: true }` for an archived pick: drop any older slot and raise the archived notice
 * @example landedUndo({ blocked: 'archived' }) // { slot: null, archived: true }
 */
export function landedUndo(next: ReturnType<typeof undoSlotFor>): {
  slot: UndoSlot | null
  archived: boolean
} {
  if (next === null) return { slot: null, archived: false }
  if ('blocked' in next) return { slot: null, archived: true }
  return { slot: next, archived: false }
}

/**
 * The day's armed 「元に戻す」 while the day as the sheet lists it still reads as the slot left it, which is what the undo's own
 * write checks: a day slot's rows the edit left (`expected`), the switch the day runs into and the stored zone, or the
 * carried-in record at the revision the pick left. The slot outlives the sheet, so this device's own tap on ホーム, or another
 * device's edit the list has since read, can change the day under it; {@link useCorrection} offers only what this returns.
 * @param slot - The day's armed undo, if any.
 * @param listed - The day's current `switches.listByDay` answer; undefined before it arrived.
 * @param timeZone - The stored zone the list was windowed in.
 * @returns
 * - `slot` while the listed day matches it, so its write would be accepted
 * - undefined once the day differs, before the list arrived, or with no slot
 * @example offeredUndo({ kind: 'activity', day, id: 'c', to: 'work', revision: 4 }, { ...listed, carriedIn: { ...c, revision: 5 } }, 'Asia/Tokyo') // undefined
 */
export function offeredUndo(
  slot: UndoSlot | undefined,
  listed: ListedDay | undefined,
  timeZone: string,
): UndoSlot | undefined {
  if (!slot || !listed) return undefined
  return slotMatchesDay(slot, listed, timeZone) ? slot : undefined
}

// Whether the listed day reads as the slot left it (see {@link offeredUndo}).
function slotMatchesDay(
  slot: UndoSlot,
  listed: ListedDay,
  timeZone: string,
): boolean {
  if (slot.kind === 'activity')
    return pickedRecord(listed, slot.id)?.revision === slot.revision
  return dayRowsMatch(slot, listed, timeZone)
}

// The record a carried-in pick changed, looked for among the day's own rows too: a zone change can list it there, and the
// undo still lands while its revision holds.
function pickedRecord(listed: ListedDay, id: string) {
  if (listed.carriedIn?.id === id) return listed.carriedIn
  return listed.rows.find((row) => row.id === id)
}

// A day slot's checks, as `replaceDay` makes them. The carried-in record is left out, as `replaceDay` leaves it out: the undo
// never rewrites it.
function dayRowsMatch(
  slot: Extract<UndoSlot, { kind: 'day' }>,
  listed: ListedDay,
  timeZone: string,
): boolean {
  if (slot.timeZone !== timeZone) return false
  if ((listed.carriedOut?.id ?? null) !== slot.carriedOutId) return false
  if (listed.rows.length !== slot.expected.length) return false
  return listed.rows.every((row, index) => {
    const expected = slot.expected[index]
    return (
      expected !== undefined &&
      row.id === expected.id &&
      row.activityId === expected.activityId &&
      row.startedAt.getTime() === expected.startedAt.getTime() &&
      (expected.revision === undefined || row.revision === expected.revision)
    )
  })
}

/**
 * The correction sheet's own state, for the day it shows: the selected row, and the row whose header takes focus (the part a
 * cut just created, or the row a merge kept), since the pressed button left the screen with its panel. `answered`: an answer
 * to a press chose the selection (a cut's new row, an undo's reselect, the archived notice's row), not the user's tap.
 */
export type CorrectionSheet = {
  day: string
  selectedId: string | null
  focusId: string | null
  answered: boolean
}

/** What an answer to a press sets on {@link CorrectionSheet}: never its day, which only a render for a new day changes. */
export type SheetPatch = Partial<Omit<CorrectionSheet, 'day'>>

/**
 * What the sheet shows for `day`, from its own state, the day's list and what the store keeps about the day. Its own state
 * belongs to the day it was made on, so a new day (midnight on today's sheet, a `?day=` change) starts it over, except the
 * row the user selected: it stays selected while the new day lists it (the running record, now carried in), and its header
 * takes focus again, since its panel left the screen while the new day's list loaded. A selection an answer made is dropped.
 * The row the archived notice was raised for is selected when nothing listed is, so a notice kept after the sheet closed is
 * seen when it reopens. Called by {@link useCorrectionState} (inside {@link useCorrection}) on every render, which stores
 * `sheet` back when it started over.
 * @param sheet - The sheet's own state.
 * @param day - The day the sheet shows.
 * @param said - The day's line and notice from the store, if any.
 * @param listed - The day's `switches.listByDay` answer, undefined while it loads (a kept selection waits for it).
 * @returns
 * - `sheet`: the same object on the same day, else the state for `day` (the user's selection kept and focused, no answer's)
 * - `selectedId`: the selected row while listed (or while the list loads), else the notice's row, else null
 * - `noticeId`, `line`: the store's, null when absent
 * @example sheetView({ day: '2026-09-08', selectedId: 'r', focusId: null, answered: false }, '2026-09-09', {}, listedWithR) // { sheet: { day: '2026-09-09', selectedId: 'r', focusId: 'r', answered: false }, selectedId: 'r', … }
 * @example sheetView({ day: '2026-09-08', selectedId: 'r', focusId: 'r', answered: true }, '2026-09-09', {}, listedWithR) // { sheet: { day: '2026-09-09', selectedId: null, focusId: null, answered: false }, selectedId: null, … }
 */
export function sheetView(
  sheet: CorrectionSheet,
  day: string,
  said: { line?: DayLine; notice?: string },
  listed: ListedDay | undefined,
): {
  sheet: CorrectionSheet
  selectedId: string | null
  noticeId: string | null
  line: DayLine | null
} {
  const current = sheet.day === day ? sheet : sheetForNewDay(sheet, day)
  const noticeId = said.notice ?? null
  return {
    sheet: current,
    selectedId: isListed(current.selectedId, listed)
      ? current.selectedId
      : noticeId,
    noticeId,
    line: said.line ?? null,
  }
}

// A new day's sheet: the user's own selection carries over with a fresh focus request; an answer's selection and focus do not.
function sheetForNewDay(sheet: CorrectionSheet, day: string): CorrectionSheet {
  const kept = sheet.answered ? null : sheet.selectedId
  return { day, selectedId: kept, focusId: kept, answered: false }
}

// Whether a selection still names a row of the day: always while the list loads, so midnight keeps it until the list lands.
function isListed(id: string | null, listed: ListedDay | undefined): boolean {
  if (id === null) return false
  if (!listed) return true
  return listed.carriedIn?.id === id || listed.rows.some((row) => row.id === id)
}

/**
 * Whether the selection a press's `hush` makes the sheet's own counts as an answer's: it does when the shown selection is
 * the notice's row (the sheet's own was empty or not listed), and otherwise stays what it was. Called by `hush` in
 * {@link useCorrectionState}, which stores the shown selection as the sheet's own.
 * @param viewSelectedId - The selection the sheet shows ({@link sheetView}).
 * @param current - The sheet's own state.
 * @returns true when the shown selection came from the notice, else `current.answered`.
 * @example hushedAnswered('r', { day, selectedId: null, focusId: null, answered: false }) // true
 * @example hushedAnswered('r', { day, selectedId: 'r', focusId: null, answered: false }) // false
 */
export function hushedAnswered(
  viewSelectedId: string | null,
  current: CorrectionSheet,
): boolean {
  return viewSelectedId !== current.selectedId || current.answered
}

/**
 * The sheet's own state after an answer to a press: the patch applies only while the sheet still shows the day the press
 * was made on, so a cut or an undo that lands after midnight or a `?day=` change selects nothing on the day now shown.
 * Called by the answers of {@link useCorrectionState} (inside {@link useCorrection}) through a functional state update, whose
 * `current.day` is the viewed day.
 * @param current - The sheet's state, whose `day` is the day it shows.
 * @param pressedDay - The day the press was made on.
 * @param patch - What the answer sets.
 * @returns
 * - `current` with `patch` applied when `current.day` is `pressedDay`
 * - `current` unchanged otherwise
 * @example onPressedDay({ day: '2026-09-09', selectedId: null, focusId: null, answered: false }, '2026-09-08', { selectedId: 'r', answered: true }) // unchanged
 */
export function onPressedDay(
  current: CorrectionSheet,
  pressedDay: string,
  patch: SheetPatch,
): CorrectionSheet {
  if (current.day !== pressedDay) return current
  return { ...current, ...patch }
}

// What a day undo selects again: the row a cut was made on (the carried-in record by id, an own row by its start), nothing
// after any other edit.
function reselectAfterUndo(
  kind: CorrectionEdit['kind'],
  row: CorrectionRow,
): Reselect {
  if (kind !== 'cut') return null
  return row.carriedIn ? { id: row.id } : { startedAt: row.start }
}

/**
 * The row to select once a day undo has landed, from the slot's {@link Reselect} and the rows `switches.replaceDay` wrote.
 * Called by the sheet's undo, so the row the edit was made on is selected again.
 * @param reselect - The slot's reselect.
 * @param written - The day's rows as the undo wrote them back, with their new ids.
 * @returns
 * - the named id for a cut of the carried-in record (it keeps its id)
 * - the id of the written row that starts at `startedAt` for a cut of an own row
 * - null when there is nothing to select, or no written row starts there
 * @example reselectedRow({ startedAt: Date.parse('2026-09-08T09:00:00+09:00') }, written) // 'new-id-of-the-9:00-row'
 */
export function reselectedRow(
  reselect: Reselect,
  written: readonly Pick<SwitchRow, 'id' | 'startedAt'>[],
): string | null {
  if (reselect === null) return null
  if ('id' in reselect) return reselect.id
  return (
    written.find((row) => row.startedAt.getTime() === reselect.startedAt)?.id ??
    null
  )
}

/** `switches.changeActivity`'s input; `revision` makes the write conditional on no other write having reached the record. */
export type ChangeActivityInput = Parameters<
  AppRouterClient['switches']['changeActivity']
>[0]
/** The call 「元に戻す」 makes for a slot; `reselect` is the row to select once the day undo lands ({@link reselectedRow}). */
export type UndoRequest =
  | {
      procedure: 'replaceDay'
      input: ReplaceDayInput
      reselect: Reselect
    }
  | { procedure: 'changeActivity'; input: ChangeActivityInput }

/**
 * The call behind 「元に戻す」 for the armed slot: the day's rows back through `replaceDay`, conditional on the day still
 * holding the rows the edit left under the same zone (named by their {@link dayDigest} when the day listed more than
 * {@link DAY_ROWS_MAX}, so the request stays under the body limit), or the carried-in record's previous activity through
 * `changeActivity`, conditional on the record still being at the revision the pick left.
 * @param slot - The armed undo.
 * @returns The procedure and its input; a day undo also names the row to select after it (after a cut).
 * @example undoRequest({ kind: 'activity', day, id: 'w', to: 'work', revision: 4 }) // { procedure: 'changeActivity', input: { id: 'w', activityId: 'work', revision: 4 } }
 */
export function undoRequest(slot: UndoSlot): UndoRequest {
  if (slot.kind === 'day')
    return {
      procedure: 'replaceDay',
      input: {
        day: slot.day,
        timeZone: slot.timeZone,
        ...(slot.rows.length > DAY_ROWS_MAX
          ? { expectedDigest: dayDigest(slot.expected) }
          : { expected: slot.expected }),
        carriedOutId: slot.carriedOutId,
        rows: slot.rows,
        account: slot.account,
      },
      reselect: slot.reselect,
    }
  return {
    procedure: 'changeActivity',
    input: { id: slot.id, activityId: slot.to, revision: slot.revision },
  }
}

/**
 * How a failed edit or undo failed, as far as the user can act on it:
 * - `uncertain`: the write may have landed. No answer (a {@link RequestTimeoutError}, a dropped connection, a page no API
 *   wrote), or any 5xx but TIMEOUT: a connection lost during COMMIT reaches the app as a plain 500, a proxy answers 502–504,
 *   and GATEWAY_TIMEOUT is a write cut off during COMMIT.
 * - `refused`: the API refused before writing, with a {@link REFUSAL} reason, or NOT_FOUND (the record is gone).
 * - `unauthorized`: the session has ended.
 * - `invalid`: BAD_REQUEST without a reason, which this app never sends on purpose.
 * - `failed`: nothing was written: TIMEOUT (the API gave up before writing; it answers 500, since Chromium resends a POST answered
 *   408) or any other 4xx.
 * The code decides, not the HTTP status: TIMEOUT and INTERNAL_SERVER_ERROR both answer 500.
 * @param error - The error the mutation failed with.
 * @returns The kind; {@link failureMessage} and {@link afterUndoFailure} build on it.
 * @example failureKind(new ORPCError('GATEWAY_TIMEOUT')) // 'uncertain'
 */
export function failureKind(error: unknown): FailureKind {
  if (!(error instanceof ORPCError)) return 'uncertain'
  if (error.code === 'TIMEOUT') return 'failed'
  if (error.status >= 500) return 'uncertain'
  // A 4xx no procedure wrote (a route the API does not have, a proxy's answer): nothing ran, so nothing can have landed.
  if (isMalformedAnswer(error)) return 'failed'
  return answeredKind(error)
}

// A 4xx a procedure answered, as {@link failureKind} sorts it.
function answeredKind(error: ORPCError<string, unknown>): FailureKind {
  if (refusalReason(error) || error.code === 'NOT_FOUND') return 'refused'
  if (error.code === 'UNAUTHORIZED') return 'unauthorized'
  return error.code === 'BAD_REQUEST' ? 'invalid' : 'failed'
}

// The `data` oRPC's link gives an answer whose body is not an oRPC error: the HTTP response itself, so its code only
// mirrors the status (a Hono 404 for an unknown route reads as NOT_FOUND).
const malformedAnswerSchema = z.object({
  status: z.number(),
  headers: z.record(z.string(), z.unknown()),
})

// Whether an oRPC error was built from an answer no procedure wrote ({@link malformedAnswerSchema}).
function isMalformedAnswer(error: ORPCError<string, unknown>): boolean {
  return malformedAnswerSchema.safeParse(error.data).success
}

/** The kinds {@link failureKind} tells apart. */
export type FailureKind =
  'uncertain' | 'refused' | 'unauthorized' | 'invalid' | 'failed'

/**
 * What a failed undo of either kind does to 「元に戻す」: an answer that can never succeed turns it off (the day or the record
 * changed elsewhere, or is gone; the previous activity was archived, with the notice; the session ended; the request was
 * malformed), and the status line says why. A failure that may pass keeps it for another try: an uncertain undo may not
 * have landed, and a replay writes only while the day still holds what the edit left (`expected`, or the pick's `revision`),
 * so it cannot undo twice.
 * @param error - The error the undo's mutation failed with.
 * @returns
 * - 'archived': BAD_REQUEST with `data.reason === 'archived'` (`changeActivity` refuses an archived target; `replaceDay` refuses
 *   a day whose current state would name one)
 * - 'clear': CONFLICT (`replaceDay`'s day-changed, `changeActivity`'s stale revision), NOT_FOUND, UNAUTHORIZED, or a
 *   BAD_REQUEST without a reason
 * - 'keep': anything else: uncertain, TIMEOUT, busy, or a 4xx no procedure wrote
 * @example afterUndoFailure(new ORPCError('CONFLICT')) // 'clear'
 */
export function afterUndoFailure(
  error: unknown,
): 'keep' | 'clear' | 'archived' {
  if (!(error instanceof ORPCError) || isMalformedAnswer(error)) return 'keep'
  const reason = refusalReason(error)
  if (error.code === 'BAD_REQUEST' && reason === REFUSAL.archived.reason)
    return 'archived'
  if (error.code === 'CONFLICT' || error.code === 'NOT_FOUND') return 'clear'
  const kind = failureKind(error)
  return kind === 'unauthorized' || kind === 'invalid' ? 'clear' : 'keep'
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

/**
 * A refusal's machine-readable reason (its `data`, one of {@link REFUSAL}), for the messages that tell refusals apart: this sheet's
 * ({@link failureMessage}) and ホーム's ({@link tapFailureMessage}).
 * @param error - The error a mutation failed with.
 * @returns the reason, or null for any other error
 * @example refusalReason(new ORPCError('TOO_MANY_REQUESTS', { data: REFUSAL.busy })) // 'busy'
 */
export function refusalReason(error: unknown): RefusalReason | null {
  if (!(error instanceof ORPCError)) return null
  return refusalDataSchema.safeParse(error.data).data?.reason ?? null
}

/**
 * What the correction sheet's status line and the 活動項目 sheet's refusal line say for each refusal reason the API sends; the
 * pen file's 状態行 and 活動項目シート・拒否の行 boards list them.
 */
const REFUSAL_MESSAGES = {
  // Neutral on purpose: another device, another tab, a double tap and this device's own late write all read the same here.
  'day-changed': '記録が変わっていたため、最新の状態を表示しました',
  'record-changed': 'この記録が変わっていたため、最新の状態を表示しました',
  archived: 'アーカイブ済みの活動になるため、変更できません',
  'no-room': 'これ以上動かせません',
  'no-neighbour': '統合できる記録がありません',
  'next-on-later-day': '次の記録は翌日なので統合できません',
  'cannot-split': 'ここでは分割できません',
  busy: '処理が混み合っています。少し待ってからもう一度お試しください',
  // The 活動項目 sheet's 🗑, ＋ 項目を追加, 戻す and ▲▼; the correction sheet never gets these.
  'in-use': '計測中の項目と最後の 1 つはアーカイブできません',
  'too-many-activities': `項目は ${LIVE_ACTIVITIES_MAX} 個までです。使わない項目をアーカイブしてください`,
  'list-changed': '項目が変わっていたため、最新の一覧を表示しました',
} as const satisfies Record<RefusalReason, string>

/**
 * What the status line says for each kind of failure but a refusal ({@link failureKind}). `uncertain` is shown once the list
 * was read again: the write may have landed, even after that read (its transaction can commit late), so it asks the user to
 * check the rows rather than claiming they are current, and it does not say that nothing came back, since a 5xx did answer.
 */
const KIND_MESSAGES = {
  uncertain: '反映されたか分かりませんでした。一覧で確かめてください',
  unauthorized: 'サインインが切れました。サインインし直してください',
  invalid: 'この変更はできません',
  failed: '保存できませんでした。もう一度お試しください',
} as const satisfies Record<Exclude<FailureKind, 'refused'>, string>

/**
 * The status line's text for a failed edit or 「元に戻す」. Every mutation of the sheet stores it from its `onError`
 * ({@link dayLine}), so no failure is silent: before, the buttons re-enabled and nothing said why. The 活動項目 sheet's refusal
 * line uses it too ({@link useActivityEditor}), for a failed add, ▲▼, 🗑 or 戻す.
 * @param error - The error the mutation failed with.
 * @returns
 * - the reason's message ({@link REFUSAL_MESSAGES}) when the API sent one
 * - the record-changed message for NOT_FOUND (the record is gone, merged away elsewhere)
 * - the kind's message ({@link KIND_MESSAGES}) for anything else
 * @example failureMessage(new ORPCError('CONFLICT', { data: REFUSAL.nextOnLaterDay })) // '次の記録は翌日なので統合できません'
 */
export function failureMessage(error: unknown): string {
  const kind = failureKind(error)
  if (kind !== 'refused') return KIND_MESSAGES[kind]
  return REFUSAL_MESSAGES[refusalReason(error) ?? 'record-changed']
}

/**
 * The status line kept for one day after its last failed edit or undo, in the store per day ({@link correctionSlice}), with
 * what the reads of that day since have shown ({@link afterDayRead}).
 */
export type DayLine = {
  /** When the failure was answered ({@link nextStamp}): only a read stamped later counts. */
  at: number
  kind: FailureKind
  /** {@link failureMessage}'s text. */
  text: string
  /** An uncertain failure whose day has not been read since: the line says the list is being read again. */
  reading: boolean
  /** {@link dayFingerprint} of the first read after the failure: the line expires once a later read differs. */
  seen: string | null
  /** The last read after the failure failed: the line says the rows may be old, until a read succeeds. */
  stale: boolean
}

// The last stamp {@link nextStamp} handed out.
let lastStamp = 0

/**
 * A strictly increasing clock for the correction sheet's failures and the reads that judge them: epoch ms, but never equal
 * to or below the previous stamp, so a read that lands in the same tick as the failure (a coarse `Date.now()`, a fast
 * local answer) or after the system clock stepped back still counts as later. Called by the sheet's `onError` and by
 * {@link useDayReads} for every read.
 * @returns epoch ms, or one more than the previous stamp when the clock has not moved past it
 * @example [nextStamp(), nextStamp()] // [1790000000000, 1790000000001] within one millisecond
 */
export function nextStamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1)
  return lastStamp
}

/**
 * The day's line for a failure just answered. Called by every sheet mutation's `onError`, which stores it for the pressed day.
 * @param error - The error the mutation failed with.
 * @param at - When it was answered ({@link nextStamp}).
 * @returns A line that has seen no read yet; reading only for an uncertain failure.
 * @example dayLine(new RequestTimeoutError(), 1000) // { at: 1000, kind: 'uncertain', text: '反映されたか…', reading: true, seen: null, stale: false }
 */
export function dayLine(error: unknown, at: number): DayLine {
  const kind = failureKind(error)
  return {
    at,
    kind,
    text: failureMessage(error),
    reading: kind === 'uncertain',
    seen: null,
    stale: false,
  }
}

/** The status line shown under the sheet's rows: a failure the user should read (`alert`), or why the panel waits (`quiet`). */
export type SheetStatus = { tone: 'alert' | 'quiet'; text: string }

/** The status line while the panel waits for a write that has not landed. */
const WRITING_MESSAGE = '反映しています…'

/** How long a write must be in flight before the status line says so: one that lands at once shows nothing. */
export const WRITING_LINE_DELAY_MS = 400

/** The status line while a write waits for the connection (web only: native never reports offline). */
const OFFLINE_MESSAGE = 'オフラインです。接続が戻ると反映されます'

/** The status line after an uncertain failure, until a read of the day lands (a read that waits for the connection included). */
const READING_MESSAGE = '一覧を読み直しています…'

/** The status line once a read of the day after the failure failed too: the rows shown may be old. */
const STALE_MESSAGE = '一覧を読み直せませんでした。表示が古いかもしれません'

/**
 * What the sheet's status line says: why the panel is dim while a write is in flight (a write started after the day's line
 * speaks over it), then the viewed day's line: quiet while an uncertain failure's day is read again, else the failure's text,
 * or that the rows may be old once a read failed too. Else nothing (the line takes no height). Lines are kept per day in the
 * store ({@link correctionSlice}), so one said about another day, after midnight or a `?day=` change, never reaches this line.
 * Offline is read from the connection, not from a mutation's `isPaused`: a tap queued behind another in its scope is paused
 * while online, and a refetch after a landed write pauses offline while its mutation reads as running.
 * @param facts.line - The viewed day's line ({@link dayLine}), until the next press, selection or undo on it, or until a read
 * shows the day moved on.
 * @param facts.waiting - Whether a `switches.*` or `settings.*` write has been in flight for {@link WRITING_LINE_DELAY_MS}
 * (a landed or refused write's refetch included, since `onSettled` awaits it; an uncertain one's refetch runs on its own).
 * @param facts.online - TanStack's `onlineManager` state.
 * @returns the line to show, or null when there is nothing to say
 * @example statusLine({ line: null, waiting: true, online: false }) // { tone: 'quiet', text: OFFLINE_MESSAGE }
 */
export function statusLine(facts: {
  line: DayLine | null
  waiting: boolean
  online: boolean
}): SheetStatus | null {
  if (facts.waiting)
    return {
      tone: 'quiet',
      text: facts.online ? WRITING_MESSAGE : OFFLINE_MESSAGE,
    }
  if (facts.line === null) return null
  if (facts.line.reading) return { tone: 'quiet', text: READING_MESSAGE }
  return {
    tone: 'alert',
    text: facts.line.stale ? STALE_MESSAGE : facts.line.text,
  }
}

/**
 * Which of the status line's two nodes carries the text: an alert mounts a fresh keyed node (announced at once), anything
 * quiet goes into the polite region, which stays mounted so a screen reader hears its first message too. Called by the
 * sheet's status line on every render.
 * @param status - {@link statusLine}'s answer.
 * @returns The text for each node, null for the one that shows nothing (the polite region then takes no room).
 * @example statusSlots({ tone: 'quiet', text: '反映しています…' }) // { alert: null, polite: '反映しています…' }
 */
export function statusSlots(status: SheetStatus | null): {
  alert: string | null
  polite: string | null
} {
  if (status === null) return { alert: null, polite: null }
  if (status.tone === 'alert') return { alert: status.text, polite: null }
  return { alert: null, polite: status.text }
}

/**
 * What a day's list says, as far as a kept line cares: the day's own rows (id, activity, start, revision), the carried-in
 * record (id, activity, revision) and the switch the day runs into. Two reads with the same fingerprint show the same day.
 * @param listed - A `switches.listByDay` answer.
 * @returns A string that changes whenever any of those fields does.
 * @example dayFingerprint({ carriedIn: null, rows: [], carriedOut: null }) // '[[],null,null]'
 */
export function dayFingerprint(listed: ListedDay): string {
  const { carriedIn, rows, carriedOut } = listed
  return JSON.stringify([
    rows.map((row) => [
      row.id,
      row.activityId,
      row.startedAt.getTime(),
      row.revision,
    ]),
    carriedIn && [carriedIn.id, carriedIn.activityId, carriedIn.revision],
    carriedOut?.id ?? null,
  ])
}

/**
 * A read of one day's list that landed: whether it succeeded, and the list cached for the day (a failed read may leave an
 * older answer there, which counts for nothing). `at` is when it landed (epoch ms).
 */
export type DayRead = { at: number; ok: boolean; listed: ListedDay | undefined }

/**
 * What a read does to the day's line: nothing, expire it, mark it stale (the read failed), or record what it showed
 * (`seen`, which also ends reading and staleness).
 */
export type LineAfterRead = 'keep' | 'expire' | 'unread' | { seen: string }

/**
 * What a read of a day's list does to that day's kept line and armed 「元に戻す」. Called by {@link useDayReads} for every read of
 * a `switches.listByDay` query that lands, sheet open or not, so a line or a slot the day has moved past is gone before the
 * sheet reopens. Paused reads (offline) never land, so they count for nothing.
 * @param facts.line - The day's kept line, if any.
 * @param facts.slot - The day's armed undo, if any.
 * @param facts.read - The read that landed.
 * @param facts.zoneWriting - Whether a `settings.*` write is in flight: the cached zone may be one the API has not stored, so
 *   the slot waits until that write settles ({@link useDayReads} judges it then). The line does not use the zone, so it is judged
 *   regardless.
 * @param facts.timeZone - The stored zone from the cached settings; undefined before they arrived.
 * @returns
 * - `line`: 'keep' with no line, a read no later than the failure, or nothing new; `{ seen }` for the first good read (a reading
 *   line shows its text then) and for a good read after a failed one; 'expire' once a good read differs from the one seen;
 *   'unread' for a failed read, except on a sign-in line (the read fails for the same reason) or one already stale; any good
 *   read expires a sign-in line, since the session is back
 * - `retireUndo`: true once the day no longer reads as the slot left it ({@link offeredUndo}); false with no slot, a failed
 *   read, an unknown zone or a zone write in flight
 * @example afterDayRead({ line, slot: undefined, read: { at: line.at + 1, ok: true, listed }, zoneWriting: false, timeZone: 'Asia/Tokyo' }) // { line: { seen: '…' }, retireUndo: false }
 */
export function afterDayRead(facts: {
  line: DayLine | undefined
  slot: UndoSlot | undefined
  read: DayRead
  zoneWriting: boolean
  timeZone: string | undefined
}): { line: LineAfterRead; retireUndo: boolean } {
  const listed = facts.read.ok ? (facts.read.listed ?? null) : null
  return {
    line: lineAfterRead(facts.line, facts.read.at, listed),
    retireUndo:
      !facts.zoneWriting && undoOutlived(facts.slot, listed, facts.timeZone),
  }
}

// The line half of {@link afterDayRead}.
function lineAfterRead(
  line: DayLine | undefined,
  at: number,
  listed: ListedDay | null,
): LineAfterRead {
  if (!line || at <= line.at) return 'keep'
  if (listed === null) return lineAfterFailedRead(line)
  return lineAfterGoodRead(line, dayFingerprint(listed))
}

// A failed read: a sign-in line stays (the read fails for the same reason), and so does a line already stale.
function lineAfterFailedRead(line: DayLine): LineAfterRead {
  return line.kind === 'unauthorized' || line.stale ? 'keep' : 'unread'
}

// A good read: expire a sign-in line (the session is back, a tab signed in again) or once the day differs from the one seen,
// else record it when nothing was seen yet or the line was stale.
function lineAfterGoodRead(line: DayLine, fingerprint: string): LineAfterRead {
  if (line.kind === 'unauthorized') return 'expire'
  if (line.seen !== null && line.seen !== fingerprint) return 'expire'
  return line.seen === null || line.stale ? { seen: fingerprint } : 'keep'
}

// The undo half of {@link afterDayRead}: the slot goes only on proof that its write would be refused, not because the day
// lists it differently. A zone change re-windows the day, and the undo holds again if the zone comes back.
function undoOutlived(
  slot: UndoSlot | undefined,
  listed: ListedDay | null,
  timeZone: string | undefined,
): boolean {
  if (!slot || !listed || timeZone === undefined) return false
  if (offeredUndo(slot, listed, timeZone)) return false
  return slotRefutedBy(slot, listed, timeZone)
}

// Whether a day that no longer offers the slot proves it stale: a day slot's day read in the slot's own zone, or the picked
// record listed at another revision. A record the day does not list may only sit outside its window now.
function slotRefutedBy(
  slot: UndoSlot,
  listed: ListedDay,
  timeZone: string,
): boolean {
  if (slot.kind === 'day') return slot.timeZone === timeZone
  return pickedRecord(listed, slot.id) !== undefined
}

// A `switches.listByDay` query key: `[['switches', 'listByDay'], { input: { day }, type: 'query' }]`.
const listByDayKeySchema = z.tuple([
  z.tuple([z.literal('switches'), z.literal('listByDay')]),
  z.object({ input: z.object({ day: daySchema }) }),
])

/**
 * Which day a query-cache update read, if it is a read of a day's list that landed. Called by {@link useDayReads} for every
 * `updated` event of the query cache.
 * @param action - The update's action: `success` or `error` for a fetch that landed (a `setQueryData` success is `manual`, not a read).
 * @param queryKey - The updated query's key.
 * @returns
 * - `{ day, ok }` for a `switches.listByDay` fetch that succeeded (`ok`) or failed
 * - null for any other query, action, or a manual write
 * @example dayOfRead({ type: 'error' }, [['switches', 'listByDay'], { input: { day: '2026-09-08' }, type: 'query' }]) // { day: '2026-09-08', ok: false }
 */
export function dayOfRead(
  action: { type: string; manual?: boolean },
  queryKey: readonly unknown[],
): { day: string; ok: boolean } | null {
  if (action.type !== 'success' && action.type !== 'error') return null
  if (action.manual) return null
  const day = listByDayKeySchema.safeParse(queryKey).data?.[1].input.day
  return day === undefined ? null : { day, ok: action.type === 'success' }
}

/**
 * Whether a mutation-cache update is a write that just settled: its `success` or `error` lands once its `onSettled` has run,
 * so the reads that callback awaited are in the cache. Called by {@link useDayReads} for every mutation-cache event.
 * @param event - The mutation-cache event.
 * @returns true for an `updated` event carrying `success` or `error`; false for the rest (a write starting, pausing, retrying)
 * @example isSettledWrite({ type: 'updated', action: { type: 'success' } }) // true
 */
export function isSettledWrite(event: {
  type: string
  action?: { type: string }
}): boolean {
  if (event.type !== 'updated') return false
  return event.action?.type === 'success' || event.action?.type === 'error'
}

/**
 * Whether a day's cached list can judge an armed 「元に戻す」 without a new read: its last fetch succeeded, none is running, and
 * nothing has marked it stale since. Called by {@link useDayReads} once a settings write settles, since that write re-reads
 * only the lists a screen watches; a closed sheet's list may still hold the rows from before its last edit.
 * @param state - The list query's state, undefined before it was first fetched.
 * @returns true only for a settled, successful list that is not invalidated
 * @example isFreshList({ status: 'success', fetchStatus: 'idle', isInvalidated: true }) // false
 */
export function isFreshList(
  state:
    Pick<QueryState, 'status' | 'fetchStatus' | 'isInvalidated'> | undefined,
): boolean {
  if (!state || state.isInvalidated) return false
  return state.status === 'success' && state.fetchStatus === 'idle'
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

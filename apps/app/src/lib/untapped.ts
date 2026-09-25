import {
  addDays,
  dayBounds,
  DETOX_MEASURED_DAYS_MAX,
  detoxCarriedDays,
  localDay,
  mergedIntoNextMark,
  mergedIntoPreviousMark,
  type TapLike,
} from '@switch-time/shared'

import type {
  CorrectionRow,
  DaySnapshot,
  ListedDay,
  UndoSlot,
} from './correction'
import { formatMonthDay } from './format'

/** What the untapped-day notes read besides the list: the viewed day, today and the stored zone and unused-day rule. */
export type UntappedFacts = {
  day: string
  today: string
  timeZone: string
  autoExcludeUnusedDays: boolean
}

/** The first and last day ('YYYY-MM-DD') whose counting an edit may change. */
type UntappedSpan = { from: string; to: string }

/**
 * An edit or undo as the notes simulate it: `pick` changes a row's activity (null = detox), the merges fold a row into its
 * neighbour, `restoreDay` writes a day undo's snapshot back over the day's rows.
 */
type UntappedEdit =
  | { kind: 'pick'; id: string; activityId: string | null }
  | { kind: 'mergePrevious' | 'mergeNext'; id: string }
  | { kind: 'restoreDay'; rows: DaySnapshot }

type Tap = TapLike & { id: string }

// Any activity: the notes only ask whether a record is detox, so which activity a pick would choose does not matter.
const ANY_ACTIVITY = 'activity'

const tapOf = (row: {
  id: string
  activityId: string | null
  startedAt: Date
  startsRun?: boolean
}): Tap => ({
  id: row.id,
  activityId: row.activityId,
  startedAt: row.startedAt.getTime(),
  startsRun: row.startsRun,
})

/**
 * The listed day as the run rule reads it, oldest first: the carried-in record, the day's rows and the first switch after
 * the day. A carried-in detox whose run started on an earlier day gets a plain detox row at 0:00 of that day in front, so
 * {@link runStartDays} counts its week from where it really started (the API's `carriedInRunStart`); taps before that are
 * not listed and cannot change anything the day's edits do. A carried-in activity gets the same row when a detox run ends
 * at it, so a pick to detox joins that run as the API would.
 * @example timeline(list, 'Asia/Tokyo') // [{ id: '', activityId: null, … }, carriedIn, …rows, carriedOut]
 */
function timeline(list: ListedDay, timeZone: string): Tap[] {
  const carriedIn = list.carriedIn ? tapOf(list.carriedIn) : null
  const runStart = list.carriedInRunStart
  const startsEarlier =
    carriedIn !== null &&
    runStart !== null &&
    runStart < localDay(new Date(carriedIn.startedAt), timeZone)
  return [
    ...(startsEarlier
      ? [
          {
            id: '',
            activityId: null,
            startedAt: dayBounds(runStart, timeZone).start,
          },
        ]
      : []),
    ...(carriedIn ? [carriedIn] : []),
    ...list.rows.map(tapOf),
    ...(list.carriedOut ? [tapOf(list.carriedOut)] : []),
  ]
}

/**
 * The timeline once `edit` lands, as the API writes it: a pick keeps the row's mark (changeActivity keeps it), a merge drops
 * the row and hands its mark over by the API's own rule ({@link mergedIntoPreviousMark}, {@link mergedIntoNextMark}), and a
 * day undo puts the snapshot in place of the day's rows. An edit on a row the timeline does not hold changes nothing.
 * @example afterEdit(taps, { kind: 'mergePrevious', id: 'work' }, 'Asia/Tokyo', window) // taps without 'work'
 */
function afterEdit(
  taps: Tap[],
  edit: UntappedEdit,
  timeZone: string,
  window: { start: number; end: number },
): Tap[] {
  if (edit.kind === 'restoreDay') {
    const outside = taps.filter(
      (tap) => tap.startedAt < window.start || tap.startedAt >= window.end,
    )
    const restored = edit.rows.map((row) =>
      tapOf({ ...row, id: `restored-${row.startedAt.getTime()}` }),
    )
    return [...outside, ...restored].sort((a, b) => a.startedAt - b.startedAt)
  }
  const index = taps.findIndex((tap) => tap.id === edit.id)
  const row = taps[index]
  if (!row) return taps
  if (edit.kind === 'pick')
    return taps.map((tap) =>
      tap === row ? { ...tap, activityId: edit.activityId } : tap,
    )
  if (edit.kind === 'mergePrevious') {
    const prev = taps[index - 1]
    // The first state has nothing to merge into (the API refuses it).
    if (!prev) return taps
    const kept = {
      ...prev,
      startsRun: mergedIntoPreviousMark(row, prev, timeZone),
    }
    return taps.flatMap((tap) =>
      tap === row ? [] : tap === prev ? [kept] : [tap],
    )
  }
  const next = taps[index + 1]
  // The current state has no later state to hand its time to (the API refuses it).
  if (!next) return taps
  const kept = {
    ...next,
    startedAt: row.startedAt,
    startsRun: mergedIntoNextMark(row, next),
  }
  return taps.flatMap((tap) =>
    tap === row ? [] : tap === next ? [kept] : [tap],
  )
}

// The days of `window` a timeline counts: a day with a tap of its own, or one a detox runs through within its run's week.
function countedDays(
  taps: readonly Tap[],
  timeZone: string,
  window: { from: string; to: string },
): Set<string> {
  const counted = detoxCarriedDays(taps, timeZone, window)
  for (const tap of taps) {
    const day = localDay(new Date(tap.startedAt), timeZone)
    if (day >= window.from && day <= window.to) counted.add(day)
  }
  return counted
}

/**
 * The untapped days whose counting `edit` may change, compared by the same rule the stats use ({@link detoxCarriedDays}):
 * from the day after the carried-in record started (or the viewed day) to today, or to {@link DETOX_MEASURED_DAYS_MAX}
 * days after the first switch after the day (the viewed day when there is none), the furthest a run the day's edits can
 * start or move reaches. That switch is taken as still running, since later taps are not listed, so days past it are only
 * possibly affected. A window that has not begun (a future day) holds no day and changes nothing.
 * @param list - The day's `switches.listByDay` answer.
 * @param edit - The edit or undo to simulate.
 * @param facts - The viewed day, today, the stored zone and whether unused days are excluded at all.
 * @returns
 * - The first and last day whose counting differs
 * - null with auto-exclusion off (every day counts), before the carried-in record reaches a day, or when nothing differs
 * @example untappedChange(list, { kind: 'pick', id: detoxRow.id, activityId: 'work' }, facts) // { from: '2026-09-19', to: '2026-09-20' }
 */
function untappedChange(
  list: ListedDay,
  edit: UntappedEdit,
  facts: UntappedFacts,
): UntappedSpan | null {
  if (!facts.autoExcludeUnusedDays) return null
  const { timeZone } = facts
  const from = list.carriedIn
    ? addDays(localDay(list.carriedIn.startedAt, timeZone), 1)
    : facts.day
  // The latest run an edit here can start or move begins on the viewed day or at the first switch after it.
  const lastRunStart = list.carriedOut
    ? localDay(list.carriedOut.startedAt, timeZone)
    : facts.day
  const reach = addDays(lastRunStart, DETOX_MEASURED_DAYS_MAX)
  const window = { from, to: facts.today < reach ? facts.today : reach }
  const before = timeline(list, timeZone)
  const after = afterEdit(
    before,
    edit,
    timeZone,
    dayBounds(facts.day, timeZone),
  )
  const counted = countedDays(before, timeZone, window)
  const countedAfter = countedDays(after, timeZone, window)
  const changed = [...new Set([...counted, ...countedAfter])]
    .filter((day) => counted.has(day) !== countedAfter.has(day))
    .sort()
  const first = changed.at(0)
  const last = changed.at(-1)
  return first && last ? { from: first, to: last } : null
}

// `9月24日` or `9月24日〜9月26日`.
const spanLabel = ({ from, to }: UntappedSpan): string =>
  from === to
    ? formatMonthDay(from)
    : `${formatMonthDay(from)}〜${formatMonthDay(to)}`

const untappedLine = (lead: string, span: UntappedSpan, verb: string): string =>
  `${lead}、タップのない日（${spanLabel(span)}）の計測${verb}変わることがあります`

/**
 * The line under 活動を変える when switching the row between detox and an activity may change which untapped days count:
 * a detox row is checked against any activity, an activity row against detox.
 * @param list - The day's list; undefined while it loads.
 * @param row - The selected row.
 * @param facts - {@link UntappedFacts}; undefined until the settings are read.
 * @returns The line, or null when the pick changes nothing (or cannot be told yet).
 * @example untappedPickNote(list, detoxRow, facts) // 'detox と活動を切り替えると、タップのない日（9月19日〜9月20日）の計測が変わることがあります'
 */
export function untappedPickNote(
  list: ListedDay | undefined,
  row: Pick<CorrectionRow, 'id' | 'activityId'>,
  facts: UntappedFacts | undefined,
): string | null {
  if (!list || !facts) return null
  const other = row.activityId === null ? ANY_ACTIVITY : null
  const span = untappedChange(
    list,
    { kind: 'pick', id: row.id, activityId: other },
    facts,
  )
  return span ? untappedLine('detox と活動を切り替えると', span, 'が') : null
}

/**
 * The line under the merge buttons when a merge the row allows may change which untapped days count; it names the button
 * when only one of them does, and spans the days of both.
 * @param list - The day's list; undefined while it loads.
 * @param row - The selected row, with which merges it allows.
 * @param facts - {@link UntappedFacts}; undefined until the settings are read.
 * @returns The line, or null when no allowed merge changes anything.
 * @example untappedMergeNote(list, onlyRow, facts) // '前の記録に統合すると、タップのない日（9月8日）の計測が変わることがあります'
 */
export function untappedMergeNote(
  list: ListedDay | undefined,
  row: Pick<CorrectionRow, 'id' | 'canMergePrevious' | 'canMergeNext'>,
  facts: UntappedFacts | undefined,
): string | null {
  if (!list || !facts) return null
  const previous = row.canMergePrevious
    ? untappedChange(list, { kind: 'mergePrevious', id: row.id }, facts)
    : null
  const next = row.canMergeNext
    ? untappedChange(list, { kind: 'mergeNext', id: row.id }, facts)
    : null
  if (previous && next) {
    const span = {
      from: previous.from < next.from ? previous.from : next.from,
      to: previous.to > next.to ? previous.to : next.to,
    }
    return untappedLine('統合すると', span, 'が')
  }
  if (previous) return untappedLine('前の記録に統合すると', previous, 'が')
  if (next) return untappedLine('次の記録に統合すると', next, 'が')
  return null
}

/**
 * Both lines of a selected row's panel, which {@link useCorrection} hands the sheet: the pick line on every row, the merge line on
 * the day's own rows only, since the carried-in record never merges.
 * @param list - The day's list; undefined while it loads.
 * @param row - The selected row.
 * @param facts - {@link UntappedFacts}; undefined until the settings are read.
 * @returns `pick` ({@link untappedPickNote}) and `merge` ({@link untappedMergeNote}), each null when it has nothing to say.
 * @example untappedRowNotes(list, carriedInRow, facts) // { pick: 'detox と活動を切り替えると、…', merge: null }
 */
export function untappedRowNotes(
  list: ListedDay | undefined,
  row: Pick<
    CorrectionRow,
    'id' | 'activityId' | 'carriedIn' | 'canMergePrevious' | 'canMergeNext'
  >,
  facts: UntappedFacts | undefined,
): { pick: string | null; merge: string | null } {
  return {
    pick: untappedPickNote(list, row, facts),
    merge: row.carriedIn ? null : untappedMergeNote(list, row, facts),
  }
}

/**
 * The line above 元に戻す when the offered undo may change which untapped days count, read from the day as listed now (so a
 * setting or another edit since the undo was armed is taken into account): a day undo writes its snapshot back, an activity
 * undo puts the carried-in record's activity back.
 * @param list - The day's list; undefined while it loads.
 * @param slot - The undo the sheet offers; undefined when none.
 * @param facts - {@link UntappedFacts}; undefined until the settings are read.
 * @returns The line, or null when the undo changes nothing or none is offered.
 * @example untappedUndoNote(list, slot, facts) // '元に戻すと、タップのない日（9月19日〜9月20日）の計測も変わることがあります'
 */
export function untappedUndoNote(
  list: ListedDay | undefined,
  slot: UndoSlot | undefined,
  facts: UntappedFacts | undefined,
): string | null {
  if (!list || !slot || !facts) return null
  const edit: UntappedEdit =
    slot.kind === 'day'
      ? { kind: 'restoreDay', rows: slot.rows }
      : { kind: 'pick', id: slot.id, activityId: slot.to }
  const span = untappedChange(list, edit, facts)
  return span ? untappedLine('元に戻すと', span, 'も') : null
}

type RowNotes = ReturnType<typeof untappedRowNotes>

// A row's lines per listed day; a list the query cache has let go of takes its lines with it.
const rowNotesByList = new WeakMap<ListedDay, Map<string, RowNotes>>()

/**
 * The sheet's untapped-day notes, worked out from the list (never stored); {@link useCorrection} spreads them into what it
 * returns. Until the stored settings are read, the zone and the unused-day rule may be defaults, so every note is null
 * rather than wrong. The panel asks for its row's lines on every clock tick, with the row rebuilt each time, so they are
 * kept per listed day ({@link rowNotesByList}) and worked out again only once a read brings a new list.
 * @param list - The day's list; undefined while it loads.
 * @param slot - The undo the sheet offers; undefined when none.
 * @param facts - {@link UntappedFacts}, with `ready` once the stored settings are read.
 * @returns `undoNote` ({@link untappedUndoNote}) and `untappedNotes`, the selected row's lines ({@link untappedRowNotes}).
 * @example untappedSheetNotes(list, slot, { ...facts, ready: true }).undoNote // '元に戻すと、…の計測も変わることがあります'
 */
export function untappedSheetNotes(
  list: ListedDay | undefined,
  slot: UndoSlot | undefined,
  facts: UntappedFacts & { ready: boolean },
) {
  const known = facts.ready ? facts : undefined
  return {
    undoNote: untappedUndoNote(list, slot, known),
    untappedNotes: (row: Parameters<typeof untappedRowNotes>[1]) => {
      if (!list || !known) return untappedRowNotes(list, row, known)
      // Everything the lines read besides the list itself.
      const key = [
        row.id,
        row.activityId,
        row.carriedIn,
        row.canMergePrevious,
        row.canMergeNext,
        known.day,
        known.today,
        known.timeZone,
        known.autoExcludeUnusedDays,
      ].join('|')
      const kept = rowNotesByList.get(list) ?? new Map<string, RowNotes>()
      rowNotesByList.set(list, kept)
      const notes = kept.get(key) ?? untappedRowNotes(list, row, known)
      kept.set(key, notes)
      return notes
    },
  }
}

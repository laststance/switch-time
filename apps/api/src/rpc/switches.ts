import { ORPCError } from '@orpc/server'
import {
  changeActivityInputSchema,
  clampStart,
  MIN_SEGMENT_MS,
  dayBounds,
  daySchema,
  detoxRunPastWeek,
  detoxRunStartDay,
  localDay,
  moveStartInputSchema,
  REFUSAL,
  replaceDayInputSchema,
  rowEditInputSchema,
  splitAtInputSchema,
  type DayBaseline,
  type DayRow,
} from '@switch-time/shared'
import { and, asc, desc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db, type Executor, type LockedTx } from '../db/client'
import { activities, switches } from '../db/schema/app'

import {
  authed,
  boundedTransaction,
  one,
  ownSwitch,
  withUserLock,
} from './base'
import { getSettings } from './settings'

type SwitchRow = typeof switches.$inferSelect

const own = (userId: string) => eq(switches.userId, userId)

/** A day's window in epoch ms, [start, end). */
type DayWindow = { start: number; end: number }

// The user's switches that start inside the window: a day's own rows.
const inDay = (userId: string, window: DayWindow) =>
  and(
    own(userId),
    gte(switches.startedAt, new Date(window.start)),
    lt(switches.startedAt, new Date(window.end)),
  )

/**
 * The latest switch is the current state; null only before the very first tap.
 * @example const current = await latestSwitch(userId)
 */
export async function latestSwitch(
  userId: string,
  executor: Executor = db,
): Promise<SwitchRow | null> {
  const [row] = await executor
    .select()
    .from(switches)
    .where(own(userId))
    .orderBy(desc(switches.startedAt))
    .limit(1)
  return row ?? null
}

// What a run's boundary rows are read for: enough for detoxRunStartDay.
const runColumns = {
  activityId: switches.activityId,
  startedAt: switches.startedAt,
  startsRun: switches.startsRun,
}

/**
 * The day the detox run that `latest` belongs to started, in `timeZone`, or null while an activity runs. Two reads on the
 * partial `switches_run_boundary_idx` and the timeline index decide it, however long the account's history is: the latest
 * boundary (an activity row, or a detox row that starts a run) and the row right after it (the run's first row when the
 * boundary is an activity). {@link detoxRunStartDay} applies the run rule to them. Called by `current` for Home's notices,
 * and by switchTo to tell a detox re-tap past the run's week from a repeat press.
 * @example await runStartOf(tx, userId, latest, 'Asia/Tokyo') // '2026-09-01' for a detox from 09-01 that a cut split on 09-05
 */
async function runStartOf(
  executor: Executor,
  userId: string,
  latest: SwitchRow,
  timeZone: string,
): Promise<string | null> {
  if (latest.activityId !== null) return null
  // The same predicate as the index, so the planner can use it.
  const [boundary] = await executor
    .select(runColumns)
    .from(switches)
    .where(
      and(
        own(userId),
        sql`${switches.activityId} is not null or ${switches.startsRun}`,
      ),
    )
    .orderBy(desc(switches.startedAt))
    .limit(1)
  const [first] = await executor
    .select(runColumns)
    .from(switches)
    .where(
      boundary
        ? and(own(userId), gt(switches.startedAt, boundary.startedAt))
        : own(userId),
    )
    .orderBy(asc(switches.startedAt))
    .limit(1)
  const rows = [boundary, first, latest].flatMap((row) =>
    row
      ? [
          {
            activityId: row.activityId,
            startedAt: row.startedAt.getTime(),
            startsRun: row.startsRun,
          },
        ]
      : [],
  )
  return detoxRunStartDay(rows, timeZone)
}

/**
 * Rejects an id that is not the user's (null = detox, nothing to check) in one query however many ids arrive; returns one
 * archivedAt per distinct id, unordered. It is replaceDay's check on the rows it writes back: 「元に戻す」 must restore past
 * rows that name an archived activity, so the user's own client can also write past time onto one, a trade-off the owner
 * accepted. Only the row that becomes the current state goes through {@link assertLiveActivities}.
 * @example await ownActivities(tx, userId, input.rows.map((row) => row.activityId)) // NOT_FOUND if any id is a stranger's
 */
async function ownActivities(
  executor: Executor,
  userId: string,
  ids: readonly (string | null)[],
): Promise<Pick<typeof activities.$inferSelect, 'archivedAt'>[]> {
  const wanted = [...new Set(ids.filter((id) => id !== null))]
  if (wanted.length === 0) return []
  const rows = await executor
    .select({ archivedAt: activities.archivedAt })
    .from(activities)
    .where(and(eq(activities.userId, userId), inArray(activities.id, wanted)))
  // A row short means an id is another user's or none at all; both look like a miss on purpose, as in {@link one}.
  if (rows.length !== wanted.length) throw new ORPCError('NOT_FOUND')
  return rows
}

/**
 * Rejects an archived activity (the user can no longer pick it) or one that is not the user's, for the writes that pick an
 * activity (switchTo and changeActivity) and those that make an existing record the current state: replaceDay for the row
 * its day leaves latest, mergeIntoPrevious when it merges the running record. The splits copy their row's own activity and
 * mergeIntoNext keeps the latest record, so neither calls it. Read under the user's lock, so an archive cannot land in between.
 * @example await assertLiveActivities(tx, userId, [input.activityId])
 */
async function assertLiveActivities(
  executor: Executor,
  userId: string,
  ids: readonly (string | null)[],
): Promise<void> {
  const rows = await ownActivities(executor, userId, ids)
  if (rows.some((row) => row.archivedAt !== null))
    // The data lets the correction sheet tell this refusal from any other BAD_REQUEST.
    throw new ORPCError('BAD_REQUEST', {
      message: 'activity is archived',
      data: REFUSAL.archived,
    })
}

/**
 * A CONFLICT the correction sheet can name: the English message is for logs, and `data` (one of {@link REFUSAL}) is what the
 * app maps to Japanese. Every CONFLICT refusal of a timeline edit throws one; the archived refusal is a BAD_REQUEST (the
 * archived checks above) and the busy one a TOO_MANY_REQUESTS (`withUserLock`), with the same kind of `data`.
 * @example throw conflict('no next state', REFUSAL.noNeighbour)
 */
const conflict = (
  message: string,
  data: (typeof REFUSAL)[keyof typeof REFUSAL],
) => new ORPCError('CONFLICT', { message, data })

// The `revision` a write leaves on a row whose activity or span it changed.
const nextRevision = sql`${switches.revision} + 1`

/**
 * Marks a row whose span another row's write changed (its end moved: a tap after it, a split or merge next to it, a moved
 * neighbour), so a {@link changeActivityAt} that saw the old span is refused. Called inside the write's transaction.
 * @example await bumpRevision(tx, prev.id)
 */
async function bumpRevision(executor: Executor, id: string): Promise<void> {
  await executor
    .update(switches)
    .set({ revision: nextRevision })
    .where(eq(switches.id, id))
}

// A correction-sheet edit: the row keeps its id, its source becomes 'correction', and its revision moves on.
const correct = async (tx: LockedTx, id: string, values: Partial<SwitchRow>) =>
  one(
    await tx
      .update(switches)
      .set({ ...values, source: 'correction', revision: nextRevision })
      .where(eq(switches.id, id))
      .returning(),
  )

/**
 * Writes an activity change only while the row is still at `revision`, in the statement that writes: any write since (an
 * activity change, a merge or split that moved its end, a moved start) has moved the revision on, so a stale sheet or undo
 * never overwrites it, even when the activity reads the same again. Called by changeActivity when the client names the
 * revision it saw (the pick on a carried-in row, and the undo it arms).
 * @returns the changed row; CONFLICT when the record changed since, NOT_FOUND when it is gone
 * @example await changeActivityAt(tx, userId, row.id, sleepId, 3) // 睡眠, unless another write reshaped the record after revision 3
 */
async function changeActivityAt(
  tx: LockedTx,
  userId: string,
  id: string,
  activityId: string | null,
  revision: number,
): Promise<SwitchRow> {
  const [changed] = await tx
    .update(switches)
    .set({ activityId, source: 'correction', revision: nextRevision })
    .where(
      and(own(userId), eq(switches.id, id), eq(switches.revision, revision)),
    )
    .returning()
  if (changed) return changed
  // Nothing matched: the row is gone (ownSwitch answers NOT_FOUND) or another write moved its revision on.
  await ownSwitch(userId, id, tx)
  throw conflict('record changed elsewhere', REFUSAL.recordChanged)
}

// A split's new row: the split row's owner and activity from `startedAt` on; the split row now ends there. splitInHalf and
// splitAt both insert it.
const insertSplit = async (tx: LockedTx, row: SwitchRow, startedAt: Date) => {
  await bumpRevision(tx, row.id)
  return one(
    await tx
      .insert(switches)
      .values({
        userId: row.userId,
        activityId: row.activityId,
        startedAt,
        source: 'split',
      })
      .returning(),
  )
}

/**
 * Deletes a row and marks the neighbour that takes over its span as merged, or NOT_FOUND if either row is already gone;
 * `values` moves that neighbour (mergeIntoNext pulls the next state back to the row's start). Called by the two merge
 * procedures inside their locked transaction.
 * @example return mergeInto(tx, row.id, next.id, { startedAt: row.startedAt }) // the next state, now starting at row.startedAt
 */
const mergeInto = async (
  tx: LockedTx,
  goneId: string,
  keptId: string,
  values: Partial<SwitchRow> = {},
) => {
  one(
    await tx
      .delete(switches)
      .where(eq(switches.id, goneId))
      .returning({ id: switches.id }),
  )
  return one(
    await tx
      .update(switches)
      .set({ ...values, source: 'merge', revision: nextRevision })
      .where(eq(switches.id, keptId))
      .returning(),
  )
}

// The user's own row plus the rows on either side of it in the timeline (null at the ends); corrections are clamped to them.
// Read under the user's lock, so they are the neighbours the write lands next to.
async function withNeighbours(tx: LockedTx, userId: string, id: string) {
  const row = await ownSwitch(userId, id, tx)
  const [prev] = await tx
    .select()
    .from(switches)
    .where(and(own(row.userId), lt(switches.startedAt, row.startedAt)))
    .orderBy(desc(switches.startedAt))
    .limit(1)
  const [next] = await tx
    .select()
    .from(switches)
    .where(and(own(row.userId), gt(switches.startedAt, row.startedAt)))
    .orderBy(asc(switches.startedAt))
    .limit(1)
  return { row, prev: prev ?? null, next: next ?? null }
}

/**
 * Every switch inside [start, end) plus its neighbours: the state carried in from before and the first switch after,
 * which closes the last segment. Oldest first: the input for segments. The three reads share one connection (one per
 * request, however fast a client refetches) and one snapshot, so a write landing between them cannot pair rows with
 * neighbours from before it.
 * @example const { carriedIn, rows, carriedOut } = await switchesBetween(userId, start, end, context.deadline)
 */
async function switchesBetween(
  userId: string,
  start: number,
  end: number,
  deadline: number,
) {
  return boundedTransaction(
    deadline,
    async (tx) => {
      const [carriedIn] = await tx
        .select()
        .from(switches)
        .where(and(own(userId), lt(switches.startedAt, new Date(start))))
        .orderBy(desc(switches.startedAt))
        .limit(1)
      const rows = await tx
        .select()
        .from(switches)
        .where(inDay(userId, { start, end }))
        .orderBy(asc(switches.startedAt))
      const [carriedOut] = await tx
        .select()
        .from(switches)
        .where(and(own(userId), gte(switches.startedAt, new Date(end))))
        .orderBy(asc(switches.startedAt))
        .limit(1)
      return {
        carriedIn: carriedIn ?? null,
        rows,
        carriedOut: carriedOut ?? null,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

// The day's own rows as a baseline or 「元に戻す」's expectation lists them, oldest first.
const dayRows = async (
  tx: LockedTx,
  userId: string,
  window: DayWindow,
): Promise<DayRow[]> =>
  tx
    .select({
      id: switches.id,
      activityId: switches.activityId,
      startedAt: switches.startedAt,
    })
    .from(switches)
    .where(inDay(userId, window))
    .orderBy(asc(switches.startedAt))

/**
 * Whether the day reads exactly as the client listed it: the same rows in the same order, each with the same activity and
 * start. An edit in place (±15 min, 活動を変える) keeps the row's id, so ids alone would miss it.
 * @example sameRows(await dayRows(tx, userId, window), input.expected) // false once another device tapped
 */
function sameRows(actual: readonly DayRow[], listed: readonly DayRow[]) {
  return (
    actual.length === listed.length &&
    actual.every((row, index) => {
      const other = listed[index]
      return (
        other !== undefined &&
        row.id === other.id &&
        row.activityId === other.activityId &&
        row.startedAt.getTime() === other.startedAt.getTime()
      )
    })
  )
}

/**
 * The record carried into the day, read under the user's lock: the latest switch before the day, whose span the day's first
 * row ends. Read by {@link sameCarriedIn}, and by replaceDay, which moves that end and may make the record current again.
 * @returns The record, or null when the account has no switch before the day
 * @example const carriedIn = await carriedInto(tx, userId, window) // { id, activityId, revision } of yesterday's last switch
 */
async function carriedInto(tx: LockedTx, userId: string, window: DayWindow) {
  const [carriedIn] = await tx
    .select({
      id: switches.id,
      activityId: switches.activityId,
      revision: switches.revision,
    })
    .from(switches)
    .where(and(own(userId), lt(switches.startedAt, new Date(window.start))))
    .orderBy(desc(switches.startedAt))
    .limit(1)
  return carriedIn ?? null
}

/**
 * The first switch after the day, read under the user's lock: where the day's last row ends. Read for {@link sameCarriedOut} in {@link checkBaseline},
 * and by replaceDay, which leaves the day's last row the current state when there is none.
 * @returns The switch's id, or null when nothing follows the day yet
 * @example const carriedOut = await carriedOutOf(tx, userId, window) // { id } of tomorrow's first switch
 */
async function carriedOutOf(tx: LockedTx, userId: string, window: DayWindow) {
  const [carriedOut] = await tx
    .select({ id: switches.id })
    .from(switches)
    .where(and(own(userId), gte(switches.startedAt, new Date(window.end))))
    .orderBy(asc(switches.startedAt))
    .limit(1)
  return carriedOut ?? null
}

/**
 * Whether the day's last row still runs into the switch the sheet saw after the day ({@link switchesBetween}'s `carriedOut`).
 * A write from the next day's sheet changes it without touching the day's rows: without this, the day's 「元に戻す」 would
 * rewrite a last row whose span the next day has since taken over, and the rewritten activity would run through that day.
 * Called by {@link checkBaseline} and replaceDay with {@link carriedOutOf}'s read under the lock.
 * @param carriedOut - The first switch after the day now, null when nothing follows it.
 * @param expectedId - The id the sheet saw; undefined skips the check (the API's own tests).
 * @returns true when there is nothing to compare or the id still matches
 * @example sameCarriedOut(await carriedOutOf(tx, userId, window), input.carriedOutId) // false once the next day's first switch was merged away
 */
function sameCarriedOut(
  carriedOut: { id: string } | null,
  expectedId: string | null | undefined,
): boolean {
  return expectedId === undefined || (carriedOut?.id ?? null) === expectedId
}

/**
 * Whether the record carried into the day is still the one the sheet listed, at the same `revision`. A write on the earlier
 * day's sheet (a pick, a merge that leaves an earlier row in its place) changes it without touching the day's rows, and
 * 前の記録に統合 on the day's first row would then hand that row's time to an activity the sheet never showed.
 * @param expected - The record the sheet listed (null: none); undefined skips the check (the API's own tests).
 * @returns true when there is nothing to compare, or the id and revision still match
 * @example await sameCarriedIn(tx, userId, window, baseline.carriedIn) // false once another device picked yesterday's last record
 */
async function sameCarriedIn(
  tx: LockedTx,
  userId: string,
  window: DayWindow,
  expected: DayBaseline['carriedIn'],
): Promise<boolean> {
  if (expected === undefined) return true
  const actual = await carriedInto(tx, userId, window)
  if (actual === null || expected === null) return actual === expected
  return actual.id === expected.id && actual.revision === expected.revision
}

// The refusal for a day that no longer reads as the sheet saw it; the data names the reason for the sheet.
const dayChanged = () => conflict('day changed elsewhere', REFUSAL.dayChanged)

/**
 * Checks, under the user's lock, that the day an edit was made on still reads as the sheet listed it: the stored zone is
 * the sheet's, the day's rows are exactly the baseline's, and the records on either side of the day are the ones it saw.
 * That makes the sheet's snapshot the day's real state before the edit, and the rows the edit leaves follow from it and the
 * row the edit returns. A baseline without rows (a day busier than `DAY_ROWS_MAX`) skips only the row comparison.
 * @returns the day's window, or null when the call named no baseline: a pick on the carried-in record (guarded by its
 *   `revision` instead, since that record reaches another day) and the API's own tests
 * @example const window = await checkBaseline(tx, userId, input.baseline) // CONFLICT day-changed after another device's tap
 */
async function checkBaseline(
  tx: LockedTx,
  userId: string,
  baseline: DayBaseline | undefined,
): Promise<DayWindow | null> {
  if (!baseline) return null
  const { timeZone } = await getSettings(userId, tx)
  if (timeZone !== baseline.timeZone) throw dayChanged()
  const window = dayBounds(baseline.day, timeZone)
  if (
    baseline.rows &&
    !sameRows(await dayRows(tx, userId, window), baseline.rows)
  )
    throw dayChanged()
  if (!(await sameCarriedIn(tx, userId, window, baseline.carriedIn)))
    throw dayChanged()
  const carriedOut = await carriedOutOf(tx, userId, window)
  if (!sameCarriedOut(carriedOut, baseline.carriedOutId)) throw dayChanged()
  return window
}

/**
 * {@link checkBaseline} for an edit of one of the day's own rows (every edit but 「ここで分割」, which cuts the carried-in
 * record): the edited row must be one of the baseline's rows (or, when the baseline lists none, start inside the day), since
 * 「元に戻す」 rewrites only those. An edit of the carried-in record would change time before the day, which the day's undo
 * could never put back.
 * @returns the day's window, or null when the call named no baseline
 * @example const window = await checkOwnRowBaseline(tx, userId, input.baseline, input.id) // BAD_REQUEST for the carried-in id
 */
async function checkOwnRowBaseline(
  tx: LockedTx,
  userId: string,
  baseline: DayBaseline | undefined,
  id: string,
): Promise<DayWindow | null> {
  const window = await checkBaseline(tx, userId, baseline)
  if (!baseline || !window) return window
  // A baseline without rows (a busy day) names no rows to look in: the row's own start must fall inside the day.
  const isOwnRow = baseline.rows
    ? baseline.rows.some((row) => row.id === id)
    : !outsideWindow(
        window,
        (await ownSwitch(userId, id, tx)).startedAt.getTime(),
      )
  if (!isOwnRow)
    throw new ORPCError('BAD_REQUEST', {
      message: "row is not one of the day's own rows",
    })
  return window
}

// The end of the day a switch starts on, in the stored zone.
async function rowDayEnd(tx: LockedTx, userId: string, startedAt: Date) {
  const { timeZone } = await getSettings(userId, tx)
  return dayBounds(localDay(startedAt, timeZone), timeZone).end
}

/**
 * Where a tap's new switch starts: now, or 1 ms after the running record when two devices' taps land in the same millisecond
 * (or a clock step put the running record ahead of now). The unique `(user_id, started_at)` index refuses a tie, and every
 * read of the timeline relies on that order. Called by switchTo under the user's lock, after reading the running record.
 * @param current - The running record, null before the very first tap.
 * @param now - The server's clock in epoch ms.
 * @returns The new switch's start.
 * @example nextSwitchStart({ startedAt: new Date(1000), … }, 1000) // new Date(1001)
 */
function nextSwitchStart(
  current: Pick<SwitchRow, 'startedAt'> | null,
  now: number,
): Date {
  if (!current) return new Date(now)
  return new Date(Math.max(now, current.startedAt.getTime() + 1))
}

/**
 * Refuses 「元に戻す」 rows that fall outside the day the client meant, lie in the future, or are not strictly ordered, before
 * replaceDay takes the lock. The unique `(user_id, started_at)` index would refuse a tie as a server error; this says it is
 * bad input instead.
 * @param rows - The rows replaceDay would write back.
 * @param window - The day's [start, end) in the zone the client sent.
 * @example assertRowsFitDay([{ startedAt: tomorrowMidnight, … }], window) // throws BAD_REQUEST
 */
function assertRowsFitDay(
  rows: Pick<DayRow, 'startedAt'>[],
  window: DayWindow,
): void {
  const latest = Math.min(window.end, Date.now())
  const startedAt = rows.map((row) => row.startedAt.getTime())
  if (startedAt.some((time) => time < window.start || time >= latest))
    throw new ORPCError('BAD_REQUEST', {
      message: 'rows must fall inside the day and not in the future',
    })
  if (
    startedAt.some((time, index) => time <= (startedAt[index - 1] ?? -Infinity))
  )
    throw new ORPCError('BAD_REQUEST', {
      message:
        'rows must be ordered by startedAt, each one later than the last',
    })
}

// A new start must stay inside the baseline's day, where 「元に戻す」 can reach it; no baseline, no day to keep to.
const outsideWindow = (window: DayWindow | null, time: number) =>
  window !== null && (time < window.start || time >= window.end)

export const switchesRouter = {
  // The running record plus the day its detox run started (null while an activity runs), for Home's detox notices. The
  // settings are read first (a half-seeded account gets its row written); the two reads after share one snapshot, so a
  // write landing between them cannot pair a record with another run's start.
  current: authed.handler(async ({ context }) => {
    const userId = context.user.id
    const { timeZone } = await getSettings(userId)
    return boundedTransaction(
      context.deadline,
      async (tx) => {
        const latest = await latestSwitch(userId, tx)
        if (!latest) return null
        return {
          ...latest,
          runStartDay: await runStartOf(tx, userId, latest, timeZone),
        }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
  }),

  switchTo: authed
    // null = detox: from now on the time is recorded to no activity, until the next real one.
    .input(z.object({ activityId: z.uuid().nullable() }))
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, context.deadline, async (tx) => {
        await assertLiveActivities(tx, userId, [input.activityId])
        const current = await latestSwitch(userId, tx)
        const now = Date.now()
        // Tapping the active state again keeps it (no zero-length segment, and the clock never drops its state), except
        // detox pressed again after its run's measured week: a new run starts here, and the days after it count again.
        let startsRun = false
        if (current !== null && current.activityId === input.activityId) {
          if (input.activityId !== null) return current
          const { timeZone } = await getSettings(userId, tx)
          const runStartDay = await runStartOf(tx, userId, current, timeZone)
          // Inside the week the press stays a no-op, so a double tap never cuts a run.
          if (!detoxRunPastWeek(runStartDay, localDay(new Date(now), timeZone)))
            return current
          startsRun = true
        }
        // The running record now ends here.
        if (current) await bumpRevision(tx, current.id)
        return one(
          await tx
            .insert(switches)
            .values({
              userId,
              activityId: input.activityId,
              startedAt: nextSwitchStart(current, now),
              startsRun,
            })
            .returning(),
        )
      })
    }),

  listByDay: authed
    .input(z.object({ day: daySchema }))
    .handler(async ({ context, input }) => {
      const { timeZone } = await getSettings(context.user.id)
      const { start, end } = dayBounds(input.day, timeZone)
      return switchesBetween(context.user.id, start, end, context.deadline)
    }),

  moveStart: authed
    .input(moveStartInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, context.deadline, async (tx) => {
        const window = await checkOwnRowBaseline(
          tx,
          userId,
          input.baseline,
          input.id,
        )
        const { row, prev, next } = await withNeighbours(tx, userId, input.id)
        const startedAt = clampStart(
          row.startedAt.getTime() + input.deltaMinutes * 60_000,
          prev?.startedAt.getTime() ?? null,
          next?.startedAt.getTime() ?? null,
          Date.now(),
        )
        if (startedAt === null || outsideWindow(window, startedAt))
          throw conflict('no room to move', REFUSAL.noRoom)
        // The previous record now ends where this one starts.
        if (prev) await bumpRevision(tx, prev.id)
        return correct(tx, row.id, { startedAt: new Date(startedAt) })
      })
    }),

  changeActivity: authed
    .input(changeActivityInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, context.deadline, async (tx) => {
        await checkOwnRowBaseline(tx, userId, input.baseline, input.id)
        const row = await ownSwitch(userId, input.id, tx)
        await assertLiveActivities(tx, userId, [input.activityId])
        if (input.revision === undefined)
          return correct(tx, row.id, { activityId: input.activityId })
        return changeActivityAt(
          tx,
          userId,
          row.id,
          input.activityId,
          input.revision,
        )
      })
    }),

  mergeIntoPrevious: authed
    .input(rowEditInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, context.deadline, async (tx) => {
        await checkOwnRowBaseline(tx, userId, input.baseline, input.id)
        const { row, prev, next } = await withNeighbours(tx, userId, input.id)
        // The first state ever has nothing to merge into; deleting it would leave the clock with no state.
        if (!prev) throw conflict('no previous state', REFUSAL.noNeighbour)
        // Merging the running record makes the previous one the current state, which an archived activity can never be.
        if (!next) await assertLiveActivities(tx, userId, [prev.activityId])
        // A detox that takes over a re-tap on the same day takes over its renewal too; from an earlier day it would move the
        // run's start back, so the renewal goes with the merged row there.
        let startsRun = prev.startsRun
        const isReTap = row.startsRun && row.activityId === null
        if (isReTap && prev.activityId === null && !prev.startsRun) {
          const { timeZone } = await getSettings(userId, tx)
          startsRun =
            localDay(prev.startedAt, timeZone) ===
            localDay(row.startedAt, timeZone)
        }
        return mergeInto(tx, row.id, prev.id, { startsRun })
      })
    }),

  // The next state takes over the row's span by starting where the row did.
  mergeIntoNext: authed
    .input(rowEditInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, context.deadline, async (tx) => {
        const window = await checkOwnRowBaseline(
          tx,
          userId,
          input.baseline,
          input.id,
        )
        const { row, next } = await withNeighbours(tx, userId, input.id)
        // The current state has no later state to hand its time to.
        if (!next) throw conflict('no next state', REFUSAL.noNeighbour)
        // 元に戻す rewrites the row's day only: a next state pulled back from a later day would be deleted with it, for good.
        // The baseline's day is the row's (the sheet lists it there); without one, the row's day is read from the stored zone.
        const end = window?.end ?? (await rowDayEnd(tx, userId, row.startedAt))
        if (next.startedAt.getTime() >= end)
          throw conflict('next state is on a later day', REFUSAL.nextOnLaterDay)
        // A detox that takes over a re-tap's start takes over its renewal too, or the days after it would fold into the old run.
        const startsRun =
          next.startsRun ||
          (row.startsRun && row.activityId === null && next.activityId === null)
        return mergeInto(tx, row.id, next.id, {
          startedAt: row.startedAt,
          startsRun,
        })
      })
    }),

  splitInHalf: authed
    .input(rowEditInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, context.deadline, async (tx) => {
        const window = await checkOwnRowBaseline(
          tx,
          userId,
          input.baseline,
          input.id,
        )
        const { row, next } = await withNeighbours(tx, userId, input.id)
        const end = next?.startedAt.getTime() ?? Date.now()
        const midpoint = Math.floor((row.startedAt.getTime() + end) / 2)
        // Both halves must keep the 1-minute floor that moveStart enforces through clampStart.
        if (end - row.startedAt.getTime() < 2 * MIN_SEGMENT_MS)
          throw conflict('segment too short to split', REFUSAL.cannotSplit)
        if (outsideWindow(window, midpoint))
          throw conflict('midpoint is on another day', REFUSAL.cannotSplit)
        return insertSplit(tx, row, new Date(midpoint))
      })
    }),

  // 「ここで分割」 on the carried-in row: the cut lands at the chosen time, which may be far from the record's middle. The
  // baseline's day holds the cut, so the new row is that day's own and its 元に戻す removes it.
  splitAt: authed
    .input(splitAtInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, context.deadline, async (tx) => {
        const window = await checkBaseline(tx, userId, input.baseline)
        const { row, next } = await withNeighbours(tx, userId, input.id)
        const at = input.at.getTime()
        // Both parts keep the 1-minute floor that moveStart enforces through clampStart; the current state ends at now.
        const earliest = row.startedAt.getTime() + MIN_SEGMENT_MS
        const latest =
          (next?.startedAt.getTime() ?? Date.now()) - MIN_SEGMENT_MS
        if (at < earliest || at > latest || outsideWindow(window, at))
          throw conflict('no room to split there', REFUSAL.cannotSplit)
        return insertSplit(tx, row, input.at)
      })
    }),

  // 「元に戻す」: the client keeps the day's previous rows and writes them back in one transaction, only while the day still
  // holds exactly the rows the edit left (`expected`) under the same stored zone. Past rows on an archived activity are
  // accepted: refusing them made every undo fail on a day that holds one, and lost a merged-away row for good. The row that
  // becomes the current state is not: an archived activity never runs.
  replaceDay: authed
    .input(replaceDayInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      // Armed under another account (a stale tab): its rows were never this user's day.
      if (input.account !== undefined && input.account !== userId)
        throw dayChanged()
      // The window the client meant; the lock below refuses the call when the stored zone is no longer this one.
      const window = dayBounds(input.day, input.timeZone)
      assertRowsFitDay(input.rows, window)
      return withUserLock(userId, context.deadline, async (tx) => {
        const { timeZone } = await getSettings(userId, tx)
        if (timeZone !== input.timeZone) throw dayChanged()
        await ownActivities(
          tx,
          userId,
          input.rows.map((row) => row.activityId),
        )
        // Under the lock no other write can land between this read and the delete below.
        if (!sameRows(await dayRows(tx, userId, window), input.expected))
          throw dayChanged()
        const carriedOut = await carriedOutOf(tx, userId, window)
        if (!sameCarriedOut(carriedOut, input.carriedOutId)) throw dayChanged()
        // The carried-in record is not compared: this rewrites the day's own rows only, and a change another device made to
        // that record (its activity) survives it. The record ends at the day's first row, which this write may move.
        const carriedIn = await carriedInto(tx, userId, window)
        // With nothing after the day, the day's last row (or, once emptied, the carried-in record) becomes the current
        // state, which an archived activity can never be; earlier rows of one are written back as they were.
        const latest = carriedOut ? null : (input.rows.at(-1) ?? carriedIn)
        if (latest) await assertLiveActivities(tx, userId, [latest.activityId])
        if (carriedIn) await bumpRevision(tx, carriedIn.id)
        await tx.delete(switches).where(inDay(userId, window))
        if (input.rows.length === 0) return []
        return tx
          .insert(switches)
          .values(
            // `userId` after the spread: a row never names another account, whatever the input schema lets through.
            input.rows.map((row) => ({
              ...row,
              userId,
              source: 'correction' as const,
            })),
          )
          .returning()
      })
    }),
}

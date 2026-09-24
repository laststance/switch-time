import { ORPCError } from '@orpc/server'
import {
  ARCHIVED_REFUSAL,
  changeActivityInputSchema,
  clampStart,
  DAY_CHANGED_REFUSAL,
  MIN_SEGMENT_MS,
  dayBounds,
  daySchema,
  localDay,
  moveStartInputSchema,
  replaceDayInputSchema,
  rowEditInputSchema,
  splitAtInputSchema,
  type DayBaseline,
  type DayRow,
} from '@switch-time/shared'
import { and, asc, desc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db/client'
import { activities, switches } from '../db/schema/app'

import {
  authed,
  one,
  ownSwitch,
  withUserLock,
  type Executor,
  type LockedTx,
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

/**
 * Rejects an id that is not the user's (null = detox, nothing to check) in one query however many ids arrive; returns one
 * archivedAt per distinct id, unordered. It is replaceDay's only activity check: 「元に戻す」 must write back rows that name an
 * archived activity, so the user's own client can also write past time onto one, a trade-off the owner accepted.
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
 * activity: switchTo and changeActivity. The splits copy their row's own activity and the merges only move time, so none
 * calls it; replaceDay stops at {@link ownActivities}. Read under the user's lock, so an archive cannot land in between.
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
      data: ARCHIVED_REFUSAL,
    })
}

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
  throw new ORPCError('CONFLICT', { message: 'record changed elsewhere' })
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
 * which closes the last segment. Oldest first: the input for segments.
 * @example const { carriedIn, rows, carriedOut } = await switchesBetween(userId, start, end)
 */
export async function switchesBetween(
  userId: string,
  start: number,
  end: number,
) {
  const [[carriedIn], rows, [carriedOut]] = await Promise.all([
    db
      .select()
      .from(switches)
      .where(and(own(userId), lt(switches.startedAt, new Date(start))))
      .orderBy(desc(switches.startedAt))
      .limit(1),
    db
      .select()
      .from(switches)
      .where(inDay(userId, { start, end }))
      .orderBy(asc(switches.startedAt)),
    db
      .select()
      .from(switches)
      .where(and(own(userId), gte(switches.startedAt, new Date(end))))
      .orderBy(asc(switches.startedAt))
      .limit(1),
  ])
  return { carriedIn: carriedIn ?? null, rows, carriedOut: carriedOut ?? null }
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

// The refusal for a day that no longer reads as the sheet saw it; the data names the reason for the sheet.
const dayChanged = () =>
  new ORPCError('CONFLICT', {
    message: 'day changed elsewhere',
    data: DAY_CHANGED_REFUSAL,
  })

/**
 * Checks, under the user's lock, that the day an edit was made on still reads as the sheet listed it: the stored zone is
 * the sheet's and the day's rows are exactly the baseline's. That makes the sheet's snapshot the day's real state before the
 * edit, and the rows the edit leaves follow from it and the row the edit returns.
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
  if (!sameRows(await dayRows(tx, userId, window), baseline.rows))
    throw dayChanged()
  return window
}

// The end of the day a switch starts on, in the stored zone.
async function rowDayEnd(tx: LockedTx, userId: string, startedAt: Date) {
  const { timeZone } = await getSettings(userId, tx)
  return dayBounds(localDay(startedAt, timeZone), timeZone).end
}

// A new start must stay inside the baseline's day, where 「元に戻す」 can reach it; no baseline, no day to keep to.
const outsideWindow = (window: DayWindow | null, time: number) =>
  window !== null && (time < window.start || time >= window.end)

export const switchesRouter = {
  current: authed.handler(async ({ context }) => latestSwitch(context.user.id)),

  switchTo: authed
    // null = detox: from now on the time is recorded to no activity, until the next real one.
    .input(z.object({ activityId: z.uuid().nullable() }))
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, async (tx) => {
        await assertLiveActivities(tx, userId, [input.activityId])
        const current = await latestSwitch(userId, tx)
        // Tapping the active state again keeps it: no zero-length segment, and the clock never drops its state.
        if (current?.activityId === input.activityId) return current
        // The running record now ends here.
        if (current) await bumpRevision(tx, current.id)
        return one(
          await tx
            .insert(switches)
            .values({
              userId,
              activityId: input.activityId,
              startedAt: new Date(),
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
      return switchesBetween(context.user.id, start, end)
    }),

  moveStart: authed
    .input(moveStartInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, async (tx) => {
        const window = await checkBaseline(tx, userId, input.baseline)
        const { row, prev, next } = await withNeighbours(tx, userId, input.id)
        const startedAt = clampStart(
          row.startedAt.getTime() + input.deltaMinutes * 60_000,
          prev?.startedAt.getTime() ?? null,
          next?.startedAt.getTime() ?? null,
          Date.now(),
        )
        if (startedAt === null || outsideWindow(window, startedAt))
          throw new ORPCError('CONFLICT', { message: 'no room to move' })
        // The previous record now ends where this one starts.
        if (prev) await bumpRevision(tx, prev.id)
        return correct(tx, row.id, { startedAt: new Date(startedAt) })
      })
    }),

  changeActivity: authed
    .input(changeActivityInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, async (tx) => {
        await checkBaseline(tx, userId, input.baseline)
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
      return withUserLock(userId, async (tx) => {
        await checkBaseline(tx, userId, input.baseline)
        const { row, prev } = await withNeighbours(tx, userId, input.id)
        // The first state ever has nothing to merge into; deleting it would leave the clock with no state.
        if (!prev)
          throw new ORPCError('CONFLICT', { message: 'no previous state' })
        return mergeInto(tx, row.id, prev.id)
      })
    }),

  // The next state takes over the row's span by starting where the row did.
  mergeIntoNext: authed
    .input(rowEditInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, async (tx) => {
        const window = await checkBaseline(tx, userId, input.baseline)
        const { row, next } = await withNeighbours(tx, userId, input.id)
        // The current state has no later state to hand its time to.
        if (!next) throw new ORPCError('CONFLICT', { message: 'no next state' })
        // 元に戻す rewrites the row's day only: a next state pulled back from a later day would be deleted with it, for good.
        // The baseline's day is the row's (the sheet lists it there); without one, the row's day is read from the stored zone.
        const end = window?.end ?? (await rowDayEnd(tx, userId, row.startedAt))
        if (next.startedAt.getTime() >= end)
          throw new ORPCError('CONFLICT', {
            message: 'next state is on a later day',
          })
        return mergeInto(tx, row.id, next.id, { startedAt: row.startedAt })
      })
    }),

  splitInHalf: authed
    .input(rowEditInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, async (tx) => {
        const window = await checkBaseline(tx, userId, input.baseline)
        const { row, next } = await withNeighbours(tx, userId, input.id)
        const end = next?.startedAt.getTime() ?? Date.now()
        const midpoint = Math.floor((row.startedAt.getTime() + end) / 2)
        // Both halves must keep the 1-minute floor that moveStart enforces through clampStart.
        if (end - row.startedAt.getTime() < 2 * MIN_SEGMENT_MS)
          throw new ORPCError('CONFLICT', {
            message: 'segment too short to split',
          })
        if (outsideWindow(window, midpoint))
          throw new ORPCError('CONFLICT', {
            message: 'midpoint is on another day',
          })
        return insertSplit(tx, row, new Date(midpoint))
      })
    }),

  // 「ここで分割」 on the carried-in row: the cut lands at the chosen time, which may be far from the record's middle. The
  // baseline's day holds the cut, so the new row is that day's own and its 元に戻す removes it.
  splitAt: authed
    .input(splitAtInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      return withUserLock(userId, async (tx) => {
        const window = await checkBaseline(tx, userId, input.baseline)
        const { row, next } = await withNeighbours(tx, userId, input.id)
        const at = input.at.getTime()
        // Both parts keep the 1-minute floor that moveStart enforces through clampStart; the current state ends at now.
        const earliest = row.startedAt.getTime() + MIN_SEGMENT_MS
        const latest =
          (next?.startedAt.getTime() ?? Date.now()) - MIN_SEGMENT_MS
        if (at < earliest || at > latest || outsideWindow(window, at))
          throw new ORPCError('CONFLICT', { message: 'no room to split there' })
        return insertSplit(tx, row, input.at)
      })
    }),

  // 「元に戻す」: the client keeps the day's previous rows and writes them back in one transaction, only while the day still
  // holds exactly the rows the edit left (`expected`) under the same stored zone. Rows on an archived activity are accepted:
  // refusing them made every undo fail on a day that holds one, and lost a merged-away row for good.
  replaceDay: authed
    .input(replaceDayInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      // The window the client meant; the lock below refuses the call when the stored zone is no longer this one.
      const window = dayBounds(input.day, input.timeZone)
      const latest = Math.min(window.end, Date.now())
      if (
        input.rows.some(
          (row) =>
            row.startedAt.getTime() < window.start ||
            row.startedAt.getTime() >= latest,
        )
      )
        throw new ORPCError('BAD_REQUEST', {
          message: 'rows must fall inside the day and not in the future',
        })
      // Ties would make the day's order (and therefore its totals) depend on Postgres' unspecified tie-break.
      const startedAt = input.rows.map((row) => row.startedAt.getTime())
      if (
        startedAt.some(
          (time, index) => time <= (startedAt[index - 1] ?? -Infinity),
        )
      )
        throw new ORPCError('BAD_REQUEST', {
          message:
            'rows must be ordered by startedAt, each one later than the last',
        })
      return withUserLock(userId, async (tx) => {
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
        // The record carried into the day ends at the day's first row, which this write may move.
        const [carriedIn] = await tx
          .select({ id: switches.id })
          .from(switches)
          .where(
            and(own(userId), lt(switches.startedAt, new Date(window.start))),
          )
          .orderBy(desc(switches.startedAt))
          .limit(1)
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

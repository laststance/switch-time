import { ORPCError } from '@orpc/server'
import {
  ARCHIVED_REFUSAL,
  clampStart,
  MIN_SEGMENT_MS,
  dayBounds,
  daySchema,
  localDay,
  moveStartInputSchema,
  replaceDayInputSchema,
  splitAtInputSchema,
} from '@switch-time/shared'
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db/client'
import { activities, switches } from '../db/schema/app'

import { authed, one, ownSwitch } from './base'
import { getSettings } from './settings'

type SwitchRow = typeof switches.$inferSelect

const own = (userId: string) => eq(switches.userId, userId)

/**
 * The latest switch is the current state; null only before the very first tap.
 * @example const current = await latestSwitch(userId)
 */
export async function latestSwitch(userId: string): Promise<SwitchRow | null> {
  const [row] = await db
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
 * @example await ownActivities(userId, input.rows.map((row) => row.activityId)) // NOT_FOUND if any id is a stranger's
 */
async function ownActivities(
  userId: string,
  ids: readonly (string | null)[],
): Promise<Pick<typeof activities.$inferSelect, 'archivedAt'>[]> {
  const wanted = [...new Set(ids.filter((id) => id !== null))]
  if (wanted.length === 0) return []
  const rows = await db
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
 * calls it; replaceDay stops at {@link ownActivities}.
 * @example await assertLiveActivities(userId, [input.activityId])
 */
async function assertLiveActivities(
  userId: string,
  ids: readonly (string | null)[],
): Promise<void> {
  const rows = await ownActivities(userId, ids)
  if (rows.some((row) => row.archivedAt !== null))
    // The data lets the correction sheet tell this refusal from any other BAD_REQUEST.
    throw new ORPCError('BAD_REQUEST', {
      message: 'activity is archived',
      data: ARCHIVED_REFUSAL,
    })
}

// A correction-sheet edit: the row keeps its id, its source becomes 'correction'.
const correct = async (id: string, values: Partial<SwitchRow>) =>
  one(
    await db
      .update(switches)
      .set({ ...values, source: 'correction' })
      .where(eq(switches.id, id))
      .returning(),
  )

/**
 * Writes an activity change only while the row still holds `from` (null = detox), in the statement that writes, so an edit
 * from another device is never overwritten; called by changeActivity when the client names what it replaces (the activity
 * undo on a carried-in row, and the pick that arms it).
 * @returns the changed row; CONFLICT when the row now holds another activity, NOT_FOUND when it is gone
 * @example await changeActivityFrom(userId, row.id, sleepId, workId) // 仕事 → 睡眠, unless the row stopped being 仕事
 */
async function changeActivityFrom(
  userId: string,
  id: string,
  activityId: string | null,
  from: string | null,
): Promise<SwitchRow> {
  const holdsFrom =
    from === null ? isNull(switches.activityId) : eq(switches.activityId, from)
  const [changed] = await db
    .update(switches)
    .set({ activityId, source: 'correction' })
    .where(and(eq(switches.id, id), holdsFrom))
    .returning()
  if (changed) return changed
  // Nothing matched: the row is gone (ownSwitch answers NOT_FOUND) or now holds another activity.
  await ownSwitch(userId, id)
  throw new ORPCError('CONFLICT', { message: 'activity changed elsewhere' })
}

// A split's new row: the split row's owner and activity from `startedAt` on. splitInHalf and splitAt both insert it.
const insertSplit = async (row: SwitchRow, startedAt: Date) =>
  one(
    await db
      .insert(switches)
      .values({
        userId: row.userId,
        activityId: row.activityId,
        startedAt,
        source: 'split',
      })
      .returning(),
  )

/**
 * Deletes a row and marks the neighbour that takes over its span as merged, in one transaction, or NOT_FOUND if either row is
 * already gone; `values` moves that neighbour (mergeIntoNext pulls the next state back to the row's start). Called by the two
 * merge procedures.
 * @example return mergeInto(row.id, next.id, { startedAt: row.startedAt }) // the next state, now starting at row.startedAt
 */
const mergeInto = async (
  goneId: string,
  keptId: string,
  values: Partial<SwitchRow> = {},
) =>
  db.transaction(async (tx) => {
    // Another merge may have removed the row since the caller read it: refuse (rolling back) rather than move the neighbour.
    one(
      await tx
        .delete(switches)
        .where(eq(switches.id, goneId))
        .returning({ id: switches.id }),
    )
    return one(
      await tx
        .update(switches)
        .set({ ...values, source: 'merge' })
        .where(eq(switches.id, keptId))
        .returning(),
    )
  })

const byId = z.object({ id: z.uuid() })

// The user's own row plus the rows on either side of it in the timeline (null at the ends); corrections are clamped to them.
async function withNeighbours(userId: string, id: string) {
  const row = await ownSwitch(userId, id)
  const [[prev], [next]] = await Promise.all([
    db
      .select()
      .from(switches)
      .where(and(own(row.userId), lt(switches.startedAt, row.startedAt)))
      .orderBy(desc(switches.startedAt))
      .limit(1),
    db
      .select()
      .from(switches)
      .where(and(own(row.userId), gt(switches.startedAt, row.startedAt)))
      .orderBy(asc(switches.startedAt))
      .limit(1),
  ])
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
      .where(
        and(
          own(userId),
          gte(switches.startedAt, new Date(start)),
          lt(switches.startedAt, new Date(end)),
        ),
      )
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

export const switchesRouter = {
  current: authed.handler(async ({ context }) => latestSwitch(context.user.id)),

  switchTo: authed
    // null = detox: from now on the time is recorded to no activity, until the next real one.
    .input(z.object({ activityId: z.uuid().nullable() }))
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      await assertLiveActivities(userId, [input.activityId])
      const current = await latestSwitch(userId)
      // ponytail: read-then-insert without a per-user lock; two simultaneous taps from one account can both land.
      // Tapping the active state again keeps it: no zero-length segment, and the clock never drops its state.
      if (current?.activityId === input.activityId) return current
      return one(
        await db
          .insert(switches)
          .values({
            userId,
            activityId: input.activityId,
            startedAt: new Date(),
          })
          .returning(),
      )
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
      const { row, prev, next } = await withNeighbours(
        context.user.id,
        input.id,
      )
      const startedAt = clampStart(
        row.startedAt.getTime() + input.deltaMinutes * 60_000,
        prev?.startedAt.getTime() ?? null,
        next?.startedAt.getTime() ?? null,
        Date.now(),
      )
      if (startedAt === null)
        throw new ORPCError('CONFLICT', { message: 'no room to move' })
      return correct(row.id, { startedAt: new Date(startedAt) })
    }),

  changeActivity: authed
    .input(
      z.object({
        id: z.uuid(),
        activityId: z.uuid().nullable(),
        // The activity the caller saw on the row (null = detox): when given, the write happens only while the row still holds it.
        from: z.uuid().nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const [row] = await Promise.all([
        ownSwitch(context.user.id, input.id),
        assertLiveActivities(context.user.id, [input.activityId]),
      ])
      if (input.from === undefined)
        return correct(row.id, { activityId: input.activityId })
      return changeActivityFrom(
        context.user.id,
        row.id,
        input.activityId,
        input.from,
      )
    }),

  mergeIntoPrevious: authed.input(byId).handler(async ({ context, input }) => {
    const { row, prev } = await withNeighbours(context.user.id, input.id)
    // The first state ever has nothing to merge into; deleting it would leave the clock with no state.
    if (!prev) throw new ORPCError('CONFLICT', { message: 'no previous state' })
    return mergeInto(row.id, prev.id)
  }),

  // The next state takes over the row's span by starting where the row did.
  mergeIntoNext: authed.input(byId).handler(async ({ context, input }) => {
    const [{ row, next }, { timeZone }] = await Promise.all([
      withNeighbours(context.user.id, input.id),
      getSettings(context.user.id),
    ])
    // The current state has no later state to hand its time to.
    if (!next) throw new ORPCError('CONFLICT', { message: 'no next state' })
    // 元に戻す rewrites the row's day only: a next state pulled back from a later day would be deleted with it, for good.
    const { end } = dayBounds(localDay(row.startedAt, timeZone), timeZone)
    if (next.startedAt.getTime() >= end)
      throw new ORPCError('CONFLICT', {
        message: 'next state is on a later day',
      })
    return mergeInto(row.id, next.id, { startedAt: row.startedAt })
  }),

  splitInHalf: authed.input(byId).handler(async ({ context, input }) => {
    const { row, next } = await withNeighbours(context.user.id, input.id)
    const end = next?.startedAt.getTime() ?? Date.now()
    // Both halves must keep the 1-minute floor that moveStart enforces through clampStart.
    if (end - row.startedAt.getTime() < 2 * MIN_SEGMENT_MS)
      throw new ORPCError('CONFLICT', { message: 'segment too short to split' })
    const midpoint = new Date(Math.floor((row.startedAt.getTime() + end) / 2))
    return insertSplit(row, midpoint)
  }),

  // 「ここで分割」 on the carried-in row: the cut lands at the chosen time, which may be far from the record's middle. It needs no
  // day: the client offers only times inside the viewed day, so the new row is that day's own and its 元に戻す removes it.
  splitAt: authed
    .input(splitAtInputSchema)
    .handler(async ({ context, input }) => {
      // gstack-shortcut(dec-7253328b): no per-user lock, upgrade when TODOS P1 "Serialize a user's switch writes" lands
      const { row, next } = await withNeighbours(context.user.id, input.id)
      const at = input.at.getTime()
      // Both parts keep the 1-minute floor that moveStart enforces through clampStart; the current state ends at now.
      const earliest = row.startedAt.getTime() + MIN_SEGMENT_MS
      const latest = (next?.startedAt.getTime() ?? Date.now()) - MIN_SEGMENT_MS
      if (at < earliest || at > latest)
        throw new ORPCError('CONFLICT', { message: 'no room to split there' })
      return insertSplit(row, input.at)
    }),

  // 「元に戻す」: the client keeps the day's previous rows and writes them back in one transaction. Rows on an archived
  // activity are accepted: refusing them made every undo fail on a day that holds one, and lost a merged-away row for good.
  replaceDay: authed
    .input(replaceDayInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      const { timeZone } = await getSettings(userId)
      const { start, end } = dayBounds(input.day, timeZone)
      const latest = Math.min(end, Date.now())
      if (
        input.rows.some(
          (row) =>
            row.startedAt.getTime() < start ||
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
      // After the in-memory checks, so a malformed request never costs the activity lookup.
      await ownActivities(
        userId,
        input.rows.map((row) => row.activityId),
      )
      return db.transaction(async (tx) => {
        await tx
          .delete(switches)
          .where(
            and(
              own(userId),
              gte(switches.startedAt, new Date(start)),
              lt(switches.startedAt, new Date(end)),
            ),
          )
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

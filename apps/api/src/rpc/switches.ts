import { ORPCError } from '@orpc/server'
import {
  clampStart,
  dayBounds,
  daySchema,
  moveStartInputSchema,
  replaceDayInputSchema,
} from '@switch-time/shared'
import { and, asc, desc, eq, gt, gte, lt } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db/client'
import { switches } from '../db/schema/app'

import { authed, one, ownActivity, ownSwitch } from './base'
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

// A correction-sheet edit: the row keeps its id, its source becomes 'correction'.
const correct = async (id: string, values: Partial<SwitchRow>) =>
  one(
    await db
      .update(switches)
      .set({ ...values, source: 'correction' })
      .where(eq(switches.id, id))
      .returning(),
  )

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
    .input(z.object({ activityId: z.uuid() }))
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      const activity = await ownActivity(userId, input.activityId)
      if (activity.archivedAt)
        throw new ORPCError('BAD_REQUEST', { message: 'activity is archived' })
      const current = await latestSwitch(userId)
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
      return correct(row.id, { startedAt: new Date(startedAt) })
    }),

  changeActivity: authed
    .input(z.object({ id: z.uuid(), activityId: z.uuid() }))
    .handler(async ({ context, input }) => {
      const [row] = await Promise.all([
        ownSwitch(context.user.id, input.id),
        ownActivity(context.user.id, input.activityId),
      ])
      return correct(row.id, { activityId: input.activityId })
    }),

  mergeIntoPrevious: authed.input(byId).handler(async ({ context, input }) => {
    const { row, prev } = await withNeighbours(context.user.id, input.id)
    // The first state ever has nothing to merge into; deleting it would leave the clock with no state.
    if (!prev) throw new ORPCError('CONFLICT', { message: 'no previous state' })
    return db.transaction(async (tx) => {
      await tx.delete(switches).where(eq(switches.id, row.id))
      return one(
        await tx
          .update(switches)
          .set({ source: 'merge' })
          .where(eq(switches.id, prev.id))
          .returning(),
      )
    })
  }),

  splitInHalf: authed.input(byId).handler(async ({ context, input }) => {
    const { row, next } = await withNeighbours(context.user.id, input.id)
    const end = next?.startedAt.getTime() ?? Date.now()
    const midpoint = new Date(Math.floor((row.startedAt.getTime() + end) / 2))
    return one(
      await db
        .insert(switches)
        .values({
          userId: row.userId,
          activityId: row.activityId,
          startedAt: midpoint,
          source: 'split',
        })
        .returning(),
    )
  }),

  // 「元に戻す」: the client keeps the day's previous rows and writes them back in one transaction.
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
      await Promise.all(
        [...new Set(input.rows.map((row) => row.activityId))].map(async (id) =>
          ownActivity(userId, id),
        ),
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
            input.rows.map((row) => ({
              userId,
              ...row,
              source: 'correction' as const,
            })),
          )
          .returning()
      })
    }),
}

import { ORPCError } from '@orpc/server'
import { activityInputSchema, reorderInputSchema } from '@switch-time/shared'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db/client'
import { activities } from '../db/schema/app'

import { authed, one } from './base'
import { latestSwitch } from './switches'

const active = (userId: string) =>
  and(eq(activities.userId, userId), isNull(activities.archivedAt))

const listActivities = async (userId: string) =>
  db
    .select()
    .from(activities)
    .where(eq(activities.userId, userId))
    .orderBy(activities.position, activities.createdAt)

// Same ids, each exactly once: a reorder must not drop, add or duplicate an activity.
const isPermutation = (ids: readonly string[], expected: readonly string[]) =>
  ids.length === expected.length &&
  new Set(ids).size === ids.length &&
  expected.every((id) => ids.includes(id))

export const activitiesRouter = {
  // Archived rows included so History can still name them; clients hide `archivedAt != null` from the grid.
  list: authed.handler(async ({ context }) => listActivities(context.user.id)),

  create: authed
    .input(activityInputSchema)
    .handler(async ({ context, input }) => {
      const [next] = await db
        .select({
          position: sql<number>`coalesce(max(${activities.position}), -1) + 1`,
        })
        .from(activities)
        .where(active(context.user.id))
      return one(
        await db
          .insert(activities)
          .values({
            ...input,
            userId: context.user.id,
            position: next?.position ?? 0,
          })
          .returning(),
      )
    }),

  update: authed
    .input(activityInputSchema.extend({ id: z.uuid() }))
    .handler(async ({ context, input: { id, ...values } }) =>
      one(
        await db
          .update(activities)
          .set(values)
          .where(
            and(eq(activities.id, id), eq(activities.userId, context.user.id)),
          )
          .returning(),
      ),
    ),

  reorder: authed
    .input(reorderInputSchema)
    .handler(async ({ context, input }) => {
      const current = await db
        .select({ id: activities.id })
        .from(activities)
        .where(active(context.user.id))
      if (
        !isPermutation(
          input.ids,
          current.map((row) => row.id),
        )
      )
        throw new ORPCError('BAD_REQUEST', {
          message: 'ids must be exactly the active activities',
        })
      await db.transaction(async (tx) => {
        // ponytail: 2n statements. Parking every row on a negative slot first keeps the unique (user, position) index happy mid-shuffle.
        await Promise.all(
          input.ids.map(async (id, index) =>
            tx
              .update(activities)
              .set({ position: -index - 1 })
              .where(eq(activities.id, id)),
          ),
        )
        await Promise.all(
          input.ids.map(async (id, index) =>
            tx
              .update(activities)
              .set({ position: index })
              .where(eq(activities.id, id)),
          ),
        )
      })
      return listActivities(context.user.id)
    }),

  archive: authed
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      const [current, activeCount] = await Promise.all([
        latestSwitch(userId),
        db.$count(activities, active(userId)),
      ])
      // The clock always holds exactly one state: its activity, and the last remaining one, stay.
      if (current?.activityId === input.id || activeCount <= 1)
        throw new ORPCError('CONFLICT', { message: 'activity is in use' })
      return one(
        await db
          .update(activities)
          .set({ archivedAt: new Date() })
          .where(and(eq(activities.id, input.id), active(userId)))
          .returning(),
      )
    }),
}

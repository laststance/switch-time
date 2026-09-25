import { ORPCError } from '@orpc/server'
import { activityInputSchema, reorderInputSchema } from '@switch-time/shared'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db, type Executor, type LockedTx } from '../db/client'
import { activities } from '../db/schema/app'
import { seedUser } from '../db/seed-user'

import { authed, boundedTransaction, one, withUserLock } from './base'
import { latestSwitch } from './switches'

const active = (userId: string) =>
  and(eq(activities.userId, userId), isNull(activities.archivedAt))

// One activity of the user's, live or archived; another account's id matches nothing, so {@link one} answers NOT_FOUND.
const owned = (userId: string, id: string) =>
  and(eq(activities.id, id), eq(activities.userId, userId))

// Every activity of the user, archived ones included, in grid order: the answer of `list` and `reorder`.
const selectActivities = async (executor: Executor, userId: string) =>
  executor
    .select()
    .from(activities)
    .where(eq(activities.userId, userId))
    .orderBy(activities.position, activities.createdAt)

const listActivities = async (userId: string) => {
  const rows = await selectActivities(db, userId)
  // Not even an archived row means the sign-up hook never finished: seed now, the same repair {@link getSettings} does.
  if (rows.length === 0) {
    await seedUser(userId)
    return listActivities(userId)
  }
  return rows
}

/**
 * The slot after the user's last live activity, where `create` puts a new one and `unarchive` puts one back. Read under the
 * user's lock ({@link withUserLock}) by both, so they never pick the same slot: `activities_user_position_idx` is unique among
 * live rows, and an archived row's own `position` may since have gone to a live one.
 * @param tx - The locked transaction that will write the row.
 * @param userId - Whose activities.
 * @returns
 * - One past the highest live `position`
 * - 0 when the user has no live activity
 * @example
 * await nextLivePosition(tx, userId) // => 6 with the six seeded activities live
 */
const nextLivePosition = async (
  tx: LockedTx,
  userId: string,
): Promise<number> => {
  const [next] = await tx
    .select({
      position: sql<number>`coalesce(max(${activities.position}), -1) + 1`,
    })
    .from(activities)
    .where(active(userId))
  return next?.position ?? 0
}

/**
 * A `position` value that gives each listed activity its own slot, so one pass of `reorder` is a single UPDATE rather than one
 * per row, and the user's lock ({@link withUserLock}) is held for the same few round trips whatever the grid's size.
 * @param ids - The activities in their new order.
 * @param slotOf - The slot of the activity at each index.
 * @returns A `case id when … then … end` expression for `.set({ position })`
 * @example
 * slotsByIndex(['a', 'b'], (index) => index) // => case "activities"."id" when $1 then $2::integer when $3 then $4::integer end ($1..$4 = 'a', 0, 'b', 1)
 */
const slotsByIndex = (
  ids: readonly string[],
  slotOf: (index: number) => number,
) =>
  sql<number>`case ${activities.id} ${sql.join(
    ids.map((id, index) => sql`when ${id} then ${slotOf(index)}::integer`),
    sql` `,
  )} end`

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
      const userId = context.user.id
      // Under the user's lock: an `unarchive` or a second create reads the same last slot only after this one wrote it.
      return withUserLock(userId, context.deadline, async (tx) =>
        one(
          await tx
            .insert(activities)
            .values({
              ...input,
              userId,
              position: await nextLivePosition(tx, userId),
            })
            .returning(),
        ),
      )
    }),

  update: authed
    .input(activityInputSchema.extend({ id: z.uuid() }))
    // Bounded by the request's deadline: a whole-row update that landed after the app gave up could overwrite the edit
    // the app sent next.
    .handler(async ({ context, input: { id, ...values } }) =>
      boundedTransaction(context.deadline, async (tx) =>
        one(
          await tx
            .update(activities)
            .set(values)
            .where(owned(context.user.id, id))
            .returning(),
        ),
      ),
    ),

  reorder: authed
    .input(reorderInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      // Under the user's lock and the request's deadline, the answer's read included: an archive, create or unarchive waits until
      // this one has checked the live set, shuffled it and read it back.
      return withUserLock(userId, context.deadline, async (tx) => {
        const current = await tx
          .select({ id: activities.id })
          .from(activities)
          .where(active(userId))
        if (
          !isPermutation(
            input.ids,
            current.map((row) => row.id),
          )
        )
          throw new ORPCError('BAD_REQUEST', {
            message: 'ids must be exactly the active activities',
          })
        // Two statements whatever the grid's size. Parking every row on a negative slot first keeps the unique (user, position) index
        // happy mid-shuffle. Only the listed rows: a live row the unlocked seeding repair ({@link seedUser}) committed since the check
        // would get no slot from the CASE.
        const listed = and(active(userId), inArray(activities.id, input.ids))
        await tx
          .update(activities)
          .set({ position: slotsByIndex(input.ids, (index) => -index - 1) })
          .where(listed)
        await tx
          .update(activities)
          .set({ position: slotsByIndex(input.ids, (index) => index) })
          .where(listed)
        // The permutation check proved live rows exist, so the seeding repair in {@link listActivities} has nothing to do here.
        return selectActivities(tx, userId)
      })
    }),

  archive: authed
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      // Under the user's lock: a tap on this activity, or a second archive, waits until this one has checked and written.
      return withUserLock(userId, context.deadline, async (tx) => {
        const current = await latestSwitch(userId, tx)
        const activeCount = await tx.$count(activities, active(userId))
        // The clock always holds exactly one state: its activity, and the last remaining one, stay.
        if (current?.activityId === input.id || activeCount <= 1)
          throw new ORPCError('CONFLICT', { message: 'activity is in use' })
        return one(
          await tx
            .update(activities)
            .set({ archivedAt: new Date() })
            .where(and(eq(activities.id, input.id), active(userId)))
            .returning(),
        )
      })
    }),

  unarchive: authed
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ context, input }) => {
      const userId = context.user.id
      // Under the user's lock, as archive: a create or a second unarchive waits, so the slot read here is still free when written.
      return withUserLock(userId, context.deadline, async (tx) => {
        const row = one(
          await tx.select().from(activities).where(owned(userId, input.id)),
        )
        // Already live, e.g. a retry of an unarchive whose answer was lost: nothing to do, and its place in the grid stays.
        if (row.archivedAt === null) return row
        // Back at the end of the live order: the old `position` may belong to a live activity since a reorder.
        return one(
          await tx
            .update(activities)
            .set({
              archivedAt: null,
              position: await nextLivePosition(tx, userId),
            })
            .where(owned(userId, row.id))
            .returning(),
        )
      })
    }),
}

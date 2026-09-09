import { ORPCError, os } from '@orpc/server'
import { and, eq } from 'drizzle-orm'

import { auth } from '../auth'
import { db } from '../db/client'
import { activities, switches } from '../db/schema/app'

// Per-request context handed to every procedure; the session is read from these headers.
export const base = os.$context<{ headers: Headers }>()

// Resolves the Better Auth session (cookie, or the bearer token the Expo client sends) once per call.
const withSession = base.use(async ({ context, next }) =>
  next({
    context: {
      session: await auth.api.getSession({ headers: context.headers }),
    },
  }),
)

// Builder for procedures that need a signed-in user; anonymous calls stop here.
export const authed = withSession.use(({ context, next }) => {
  if (!context.session) throw new ORPCError('UNAUTHORIZED')
  return next({ context: { user: context.session.user } })
})

/**
 * First row of a query that must hit, else NOT_FOUND; another user's id looks exactly like a missing one on purpose.
 * @example one(await db.update(t).set(v).where(eq(t.id, id)).returning())
 */
export function one<T>(rows: T[]): T {
  const [row] = rows
  if (row === undefined) throw new ORPCError('NOT_FOUND')
  return row
}

/** The user's own activity row via {@link one}. */
export const ownActivity = async (userId: string, id: string) =>
  one(
    await db
      .select()
      .from(activities)
      .where(and(eq(activities.userId, userId), eq(activities.id, id))),
  )

/** The user's own switch row via {@link one}. */
export const ownSwitch = async (userId: string, id: string) =>
  one(
    await db
      .select()
      .from(switches)
      .where(and(eq(switches.userId, userId), eq(switches.id, id))),
  )

import { ORPCError, os } from '@orpc/server'
import { and, eq, sql } from 'drizzle-orm'

import { auth } from '../auth'
import { db, type LockedTx } from '../db/client'
import { switches } from '../db/schema/app'

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

/** The user's own switch row via {@link one}, read in the locked transaction that will write on it. */
export const ownSwitch = async (userId: string, id: string, tx: LockedTx) =>
  one(
    await tx
      .select()
      .from(switches)
      .where(and(eq(switches.userId, userId), eq(switches.id, id))),
  )

/** The first key of the lock pair: the lock guards one user's timeline, so no other use of advisory locks can collide with it. */
const TIMELINE_LOCK_NAMESPACE = 1

/**
 * How long a write waits for the user's lock (Postgres `lock_timeout`, for this transaction only) before it fails: each waiting
 * write holds a pool connection, so a burst from one account must give up rather than starve every other account's requests.
 */
const TIMELINE_LOCK_TIMEOUT = '10s'

/**
 * Runs `work` in one transaction that first takes the user's timeline lock (`pg_advisory_xact_lock`, released at commit or
 * rollback). Every write to a user's switches, `activities.archive` and a stored-zone change take it, and read what they
 * decide on inside it, so two devices' writes run one after the other: a merge sees the neighbours the other merge left,
 * two 「元に戻す」 never both delete and insert, a tap cannot slip between archive's check and its write. A write that waits
 * longer than {@link TIMELINE_LOCK_TIMEOUT} fails (a server error, which the client treats as a passing failure).
 * @param userId - Whose timeline; other users never wait on it (a `hashtext` collision only makes two users take turns).
 * @param work - The reads and writes, all through the transaction it is handed.
 * @returns whatever `work` returns, once committed
 * @example return withUserLock(userId, async (tx) => mergeInto(tx, row.id, prev.id))
 */
export async function withUserLock<T>(
  userId: string,
  work: (tx: LockedTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('lock_timeout', ${TIMELINE_LOCK_TIMEOUT}, true)`,
    )
    await tx.execute(
      sql`select pg_advisory_xact_lock(${TIMELINE_LOCK_NAMESPACE}, hashtext(${userId}))`,
    )
    return work(tx)
  })
}

import { ORPCError, os } from '@orpc/server'
import { REFUSAL } from '@switch-time/shared'
import { and, eq, sql } from 'drizzle-orm'
import type { PgTransactionConfig } from 'drizzle-orm/pg-core'

import { auth } from '../auth'
import {
  DeadlineError,
  REQUEST_DEADLINE_MS,
  inTransaction,
  requestDeadline,
  type LockedTx,
} from '../db/client'
import { switches } from '../db/schema/app'

// Per-request context handed to every procedure; the session is read from these headers.
export const base = os.$context<{ headers: Headers }>()

/**
 * The answer to a call that ended with nothing saved because time ran out: TIMEOUT, as status 500, not its default 408 (a
 * browser resends a POST answered 408 on a reused connection, which would replay a cut-off write behind the app's back).
 * @example throw timedOut()
 */
const timedOut = () =>
  new ORPCError('TIMEOUT', { status: 500, message: 'nothing was saved' })

// Stamps the request's arrival and deadline before the session lookup, so every wait after it counts against one budget, and
// a tap is recorded from the moment it reached the server rather than after the session read and the write queue. The deadline
// also bounds every statement run through `db` outside a transaction (the session lookup, the plain reads): they read it from
// {@link requestDeadline}, and a call that ends because one reached it is answered as TIMEOUT here, even when Better Auth
// wrapped the DeadlineError in its own 500.
const withDeadline = base.use(async ({ next }) => {
  const arrivedAt = Date.now()
  const clock = { deadline: arrivedAt + REQUEST_DEADLINE_MS, expired: false }
  try {
    return await requestDeadline.run(clock, async () =>
      next({ context: { arrivedAt, deadline: clock.deadline } }),
    )
  } catch (error) {
    if (clock.expired) throw timedOut()
    throw error
  }
})

// Resolves the Better Auth session (cookie, or the bearer token the Expo client sends) once per call.
const withSession = withDeadline.use(async ({ context, next }) =>
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

// Postgres's own answers to a wait that ran out, each rolling the transaction back: `lock_timeout` (55P03) and
// `statement_timeout` (57014), both set by {@link withUserLock}.
const SERVER_TIMEOUT_CODES: ReadonlySet<unknown> = new Set(['55P03', '57014'])

// Whether the error, or a cause of it (drizzle wraps the driver's error), is one of {@link SERVER_TIMEOUT_CODES}.
const isServerTimeout = (error: unknown): boolean => {
  for (
    let depth = 0;
    depth < 4 && typeof error === 'object' && error;
    depth++
  ) {
    if ('code' in error && SERVER_TIMEOUT_CODES.has(error.code)) return true
    error = 'cause' in error ? error.cause : undefined
  }
  return false
}

/**
 * {@link inTransaction} with its deadline answered as an ORPCError: TIMEOUT when nothing was committed, GATEWAY_TIMEOUT when
 * the cut-off came during a write's COMMIT, so the write may have landed (a read-only transaction always answers TIMEOUT).
 * TIMEOUT goes out as status 500, not its default 408: a browser resends a POST answered 408 on a reused connection, which
 * would replay a cut-off write behind the app's back. For a call that must hold one connection but takes no user lock (a
 * read of several queries, `activities.update`); {@link withUserLock} goes through it too.
 * @example return boundedTransaction(context.deadline, (tx) => tx.select().from(switches), { accessMode: 'read only' })
 */
export async function boundedTransaction<T>(
  deadline: number,
  work: (tx: LockedTx) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  try {
    return await inTransaction(deadline, work, config)
  } catch (error) {
    // Postgres rolled the transaction back itself: nothing was saved, like a write cut off at its deadline.
    if (isServerTimeout(error)) throw timedOut()
    if (!(error instanceof DeadlineError)) throw error
    // A read commits nothing, so its outcome is never in doubt.
    if (error.committing && config?.accessMode !== 'read only')
      throw new ORPCError('GATEWAY_TIMEOUT', {
        message: 'the write may or may not have been saved',
      })
    throw timedOut()
  }
}

/**
 * How many multi-query reads ({@link boundedRead}) one account may have in flight in this process. Below the pool's 10
 * connections, and with the writes' {@link TIMELINE_WRITES_PER_USER} still under it, so one account sending a burst of
 * reads (a script calling `stats.month`) cannot hold every connection for up to a deadline.
 */
const READS_PER_USER = 4

// The accounts with reads in flight in this process, and how many (an account with none has no entry).
const readsInFlight = new Map<string, number>()

/**
 * {@link boundedTransaction} for a read of several queries on one snapshot, capped per account: the caller's
 * {@link READS_PER_USER}th read in flight is the last, and a burst above it is refused at once instead of taking a
 * connection. Called by `stats.*`, `switches.current` and `switches.listByDay`.
 * @param userId - Whose read; other accounts' reads never count against it.
 * @param deadline - The request's deadline (`context.deadline`), epoch ms.
 * @param work - The reads, all through the transaction it is handed.
 * @returns whatever `work` returns
 * @throws ORPCError TOO_MANY_REQUESTS (`REFUSAL.busy`) when the account already has its cap of reads in flight.
 * @example return boundedRead(userId, context.deadline, async (tx) => latestSwitch(userId, tx))
 */
export async function boundedRead<T>(
  userId: string,
  deadline: number,
  work: (tx: LockedTx) => Promise<T>,
): Promise<T> {
  const inFlight = readsInFlight.get(userId) ?? 0
  if (inFlight >= READS_PER_USER)
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: 'too many reads in flight',
      data: REFUSAL.busy,
    })
  readsInFlight.set(userId, inFlight + 1)
  try {
    return await boundedTransaction(deadline, work, {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
  } finally {
    const left = (readsInFlight.get(userId) ?? 1) - 1
    if (left > 0) readsInFlight.set(userId, left)
    else readsInFlight.delete(userId)
  }
}

/** The first key of the lock pair: the lock guards one user's timeline, so no other use of advisory locks can collide with it. */
const TIMELINE_LOCK_NAMESPACE = 1

/**
 * How long a write waits for the user's lock (Postgres `lock_timeout`, for this transaction only) before it fails. One
 * account's writes in this process queue in {@link withUserLock} before they take a connection, so this only waits for
 * another API instance's write, or for a transaction of a cut-off write the server has not dropped yet.
 */
const TIMELINE_LOCK_TIMEOUT = '10s'

/** How long one statement of a write under {@link withUserLock} may run on the server (Postgres `statement_timeout`); above the lock wait. */
const TIMELINE_STATEMENT_TIMEOUT = '15s'

/**
 * How many writes under {@link withUserLock} one account may have in flight in this process, the running one included: the
 * timeline writes, the activity writes and a zone change share the cap. A burst above this is refused at once rather than
 * queued, since the queue already holds more than a request's deadline lets it wait for.
 */
const TIMELINE_WRITES_PER_USER = 4

/** One account's writes under {@link withUserLock} in this process: how many are in flight, and the turn the next arrival waits for. */
type TimelineQueue = { size: number; tail: Promise<void> }

// The accounts with writes under the user's lock in flight in this process (an account with none has no entry).
const timelineQueues = new Map<string, TimelineQueue>()

/**
 * How many writes under {@link withUserLock} the account has in flight in this process, the running one included. The tests wait on it to
 * know a write has queued, since a write queued here holds no database lock `pg_stat_activity` would show.
 */
export const timelineWritesInFlight = (userId: string): number =>
  timelineQueues.get(userId)?.size ?? 0

// Resolves once `turn` has, or rejects with a DeadlineError at `deadline`, whichever comes first.
async function awaitTurn(turn: Promise<void>, deadline: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DeadlineError(false)),
      Math.max(0, deadline - Date.now()),
    )
  })
  try {
    await Promise.race([turn, expired])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Runs `work` in one transaction that first takes the user's timeline lock (`pg_advisory_xact_lock`, released at commit or
 * rollback). Every write to a user's switches, the activity writes that pick or check the live set (`activities.create`,
 * `reorder`, `archive`, `unarchive`) and a stored-zone change take it, and read what they decide on inside it, so two devices'
 * writes run one after the other: a merge sees the neighbours the other merge left, two 「元に戻す」 never both delete and
 * insert, a tap cannot slip between archive's check and its write, a create and an unarchive never take the same slot.
 *
 * The account's writes first queue in this process, in arrival order, so only the one at the head holds a pool connection
 * and several accounts' bursts cannot fill the pool with writes waiting on their own locks. The advisory lock still orders
 * writes across API instances.
 *
 * ```
 * arrive ── cap in flight ─────────────► TOO_MANY_REQUESTS (busy)
 *   │ queue behind the account's last write
 *   │ deadline passes in the queue ────► TOO_MANY_REQUESTS (busy); the next write still waits for the one before
 *   ▼ head: connection, timeouts, advisory lock, work, COMMIT
 *        deadline passes ──────────────► connection destroyed; TIMEOUT, or GATEWAY_TIMEOUT during COMMIT
 * ```
 * @param userId - Whose timeline; other users never wait on it (a `hashtext` collision only makes two users take turns).
 * @param deadline - The request's deadline (`context.deadline`), epoch ms; the wait in the queue counts against it.
 * @param work - The reads and writes, all through the transaction it is handed.
 * @returns whatever `work` returns, once committed
 * @example return withUserLock(userId, context.deadline, async (tx) => mergeInto(tx, row.id, prev.id))
 */
export async function withUserLock<T>(
  userId: string,
  deadline: number,
  work: (tx: LockedTx) => Promise<T>,
): Promise<T> {
  const queue = timelineQueues.get(userId) ?? {
    size: 0,
    tail: Promise.resolve(),
  }
  if (queue.size >= TIMELINE_WRITES_PER_USER)
    throw new ORPCError('TOO_MANY_REQUESTS', {
      message: 'too many writes under the user lock in flight',
      data: REFUSAL.busy,
    })
  timelineQueues.set(userId, queue)
  queue.size += 1
  const previous = queue.tail
  const done = Promise.withResolvers<void>()
  queue.tail = done.promise
  try {
    try {
      await awaitTurn(previous, deadline)
    } catch {
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: 'write under the user lock queued past its deadline',
        data: REFUSAL.busy,
      })
    }
    // READ COMMITTED on purpose: each statement after the lock reads what the writer before it committed. Under REPEATABLE
    // READ the snapshot would be taken before the wait, and the lock would serialize nothing.
    return await boundedTransaction(
      deadline,
      async (tx) => {
        await tx.execute(
          sql`select set_config('lock_timeout', ${TIMELINE_LOCK_TIMEOUT}, true), set_config('statement_timeout', ${TIMELINE_STATEMENT_TIMEOUT}, true)`,
        )
        await tx.execute(
          sql`select pg_advisory_xact_lock(${TIMELINE_LOCK_NAMESPACE}, hashtext(${userId}))`,
        )
        return work(tx)
      },
      { isolationLevel: 'read committed' },
    )
  } finally {
    // The next write's turn comes once every write before it is done, so one that gave up in the queue keeps the order.
    void previous.then(done.resolve)
    queue.size -= 1
    if (queue.size === 0) timelineQueues.delete(userId)
  }
}

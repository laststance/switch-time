import { AsyncLocalStorage } from 'node:async_hooks'

import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgTransactionConfig } from 'drizzle-orm/pg-core'
import { Pool, type PoolClient, type QueryConfig } from 'pg'

import { dbEnv } from './env'
import { relations } from './relations'

// DO Managed Postgres only accepts TLS signed by its own CA; local Compose Postgres has no TLS at all.
// `pg` lets the connection string win over `ssl`, so DO's `?sslmode=require` would drop the CA: strip it.
const url = new URL(dbEnv.DATABASE_URL)
url.searchParams.delete('sslmode')

/** How long a request waits for a free pool connection before it fails, rather than queueing without bound. */
const POOL_CONNECTION_TIMEOUT_MS = 10_000

/**
 * How long Postgres lets a session sit inside a transaction without sending a statement before it ends the session. A write
 * cut off at its deadline ({@link inTransaction}) leaves its transaction open on a half-open connection the server cannot
 * tell is gone; this ends it and frees the advisory lock it holds. Nothing here pauses that long inside a transaction.
 */
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 15_000

/** How long a pool connection sits idle before the OS sends its first TCP keepalive probe. */
const KEEPALIVE_INITIAL_DELAY_MS = 10_000

export const pool = new Pool({
  connectionString: url.href,
  ssl: dbEnv.DATABASE_CA_CERT ? { ca: dbEnv.DATABASE_CA_CERT } : false,
  connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
  // Probes idle sockets so a connection a failover left dead is noticed and dropped before it is lent again. The OS picks the
  // probe interval and count (minutes on Linux), so this does not bound a call: the deadline in inTransaction does.
  keepAlive: true,
  keepAliveInitialDelayMillis: KEEPALIVE_INITIAL_DELAY_MS,
  idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
})

// Log a connection error rather than crash on it. `pg` emits `error` on a client whose connection breaks between statements,
// and pg-pool listens only while the client is idle in the pool: a checked-out client would throw it as unhandled. The
// broken client is evicted on release (it is no longer queryable), and the call using it fails on its next statement.
const logConnectionError = (error: Error): void => {
  console.error('database connection error', error)
}
pool.on('connect', (client) => client.on('error', logConnectionError))
pool.on('error', logConnectionError)

/** How long ending an abandoned session may take; `pg_terminate_backend` answers at once from a server that is reachable. */
const SESSION_END_TIMEOUT_MS = 2_000

/**
 * Ends the server session a cut-off transaction left behind, so the transaction and the user's lock go at once. Bounded
 * itself: when the server does not answer, the connection it used is destroyed too rather than held, so a database that
 * stopped answering cannot fill the pool with these. Called by {@link inTransaction} at a deadline, never awaited.
 * @param backendPid - The abandoned session's pid.
 * @param lentAt - When the pool lent that session's connection. Only a session that started before it is ended: a later
 *   one holding the same pid (the OS reused it, or a failover moved the pool to another server) is someone else's.
 * @example void endSession(4242, lentAt).catch(logConnectionError)
 */
async function endSession(backendPid: number, lentAt: Date): Promise<void> {
  const client = await pool.connect()
  let released = false
  const giveBack = (error?: Error): void => {
    if (released) return
    released = true
    client.release(error)
  }
  const timer = setTimeout(() => {
    giveBack(new Error('ending the abandoned session timed out'))
  }, SESSION_END_TIMEOUT_MS)
  try {
    await client.query(
      // 1 s of slack for this host's clock running behind the server's, which would otherwise skip a freshly opened session.
      "select pg_terminate_backend(pid) from pg_stat_activity where pid = $1 and backend_start <= $2::timestamptz + interval '1 second'",
      [backendPid, lentAt],
    )
  } finally {
    clearTimeout(timer)
    giveBack()
  }
}

/**
 * A transaction opened by {@link inTransaction}. Opened through {@link withUserLock}, it holds the user's lock until it
 * commits or rolls back; the reads and `activities.update` open one without the lock.
 */
export type LockedTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** `db` or a transaction: the reads and writes below run in whichever the procedure opened. */
export type Executor = typeof db | LockedTx

/**
 * How long a request may take from its arrival, session lookup included, before the server gives up on it. Below the app's
 * 30 s `REQUEST_TIMEOUT_MS`, so a write the server cut off has settled before the app stops waiting and lets the next
 * write of the same scope go.
 */
export const REQUEST_DEADLINE_MS = 25_000

/**
 * {@link inTransaction} reached its deadline. `committing` tells whether `work` had finished, so COMMIT may have reached the
 * database (the outcome is unknown), or not (nothing committed: the connection was destroyed first, or the transaction was
 * rolled back because `work` finished past the deadline).
 */
export class DeadlineError extends Error {
  constructor(readonly committing: boolean) {
    super(
      committing
        ? 'deadline passed while committing'
        : 'deadline passed before commit',
    )
    this.name = 'DeadlineError'
  }
}

/**
 * Runs `use` on a pool connection the call owns and gives up at `deadline`: the connection is then destroyed (a stuck socket
 * never returns to the pool), its server session is ended with `pg_terminate_backend` so a transaction and the lock it holds go
 * at once (when that does not reach or match the session, an idle one ends after {@link IDLE_IN_TRANSACTION_TIMEOUT_MS} and a
 * running statement at its `statement_timeout`), and the call rejects with {@link DeadlineError} without waiting for `use`. A
 * call already past its deadline takes no connection at all. The pool's own release cannot do this: it waits for the
 * statement, and a half-open socket never answers.
 * @param deadline - Epoch ms; a call that reaches it before it has a connection releases the late connection unused.
 * @param isCommitting - Read when the deadline passes, for {@link DeadlineError.committing}: whether only COMMIT was left.
 * @param use - Runs on the connection; its rejection is passed on, and the connection is released when it settles.
 * @returns whatever `use` returns
 */
async function onClientUntil<T>(
  deadline: number,
  isCommitting: () => boolean,
  use: (client: PoolClient) => Promise<T>,
): Promise<T> {
  // A request that spent its budget before this point (a slow session lookup) never takes a connection.
  if (Date.now() >= deadline) throw new DeadlineError(false)
  let expired = false
  let release: ((error?: Error) => void) | undefined
  let abandon: (() => void) | undefined
  const cutOff = Promise.withResolvers<never>()
  const timer = setTimeout(
    () => {
      expired = true
      abandon?.()
      cutOff.reject(new DeadlineError(isCommitting()))
    },
    Math.max(0, deadline - Date.now()),
  )
  const run = async () => {
    const client = await pool.connect()
    const lentAt = new Date()
    let released = false
    // Exactly once, whichever of the deadline and the settled call comes first.
    release = (error): void => {
      if (released) return
      released = true
      client.release(error)
    }
    abandon = (): void => {
      if (released) return
      // The server session's pid, from the connection's startup (`pg` sets it, its types leave it out).
      const backendPid =
        'processID' in client && typeof client.processID === 'number'
          ? client.processID
          : undefined
      // Releasing with an error makes pg-pool end the client, which destroys the socket while a statement is still waiting.
      release?.(new Error('deadline passed'))
      // The server only notices a closed socket when it next reads or writes on it: a statement still running there would
      // keep the user's lock until its statement_timeout, past the next write's lock_timeout. End that session now.
      if (backendPid !== undefined)
        void endSession(backendPid, lentAt).catch(logConnectionError)
    }
    // The clock, not only the timer: a stalled event loop can run this before a timer that is already due.
    if (expired || Date.now() >= deadline) {
      release()
      throw new DeadlineError(false)
    }
    try {
      return await use(client)
    } finally {
      release()
    }
  }
  try {
    return await Promise.race([run(), cutOff.promise])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Runs `work` in one transaction on a connection the call owns, and gives up at `deadline` ({@link onClientUntil}).
 * `db.transaction` cannot do this: it releases its connection itself, only once the transaction settles, and never when
 * BEGIN fails. Called only through {@link boundedTransaction}, which answers the {@link DeadlineError} as an ORPCError.
 * @param deadline - Epoch ms; a call that reaches it before it has a connection releases the late connection unused.
 * @param work - Reads and writes, all through the transaction it is handed.
 * @param config - Isolation level and access mode for BEGIN.
 * @returns whatever `work` returns, once committed
 * @example await inTransaction(deadline, (tx) => tx.select().from(switches), { accessMode: 'read only' })
 */
export async function inTransaction<T>(
  deadline: number,
  work: (tx: LockedTx) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  let committing = false
  return onClientUntil(
    deadline,
    () => committing,
    async (client) =>
      drizzle({ client, relations }).transaction(async (tx) => {
        const result = await work(tx)
        // Past the deadline, roll back instead of sending a COMMIT the app may no longer wait for.
        if (Date.now() >= deadline) throw new DeadlineError(false)
        // Only COMMIT is left from here: a cut-off now cannot tell whether it landed.
        committing = true
        return result
      }, config),
  )
}

/** The request being served: its deadline (epoch ms), and whether a statement of it has reached that deadline. */
type RequestClock = { deadline: number; expired: boolean }

/**
 * The {@link RequestClock} of the request being served. Set by the router's first middleware around the whole call, so a
 * statement run through {@link db} (Better Auth's session lookup included) reads the deadline without being handed it, and
 * the middleware can tell a statement ran out of time even when the library that ran it wrapped the error.
 */
export const requestDeadline = new AsyncLocalStorage<RequestClock>()

/**
 * Runs one statement on a pooled connection the call owns, under the request's deadline ({@link requestDeadline}; a
 * statement outside a request gets a whole {@link REQUEST_DEADLINE_MS} from now). Stands in for the pool's own query, which
 * lends a connection and waits for it, however long a half-open socket takes to give up. Called by drizzle for every
 * statement run through {@link db} outside a transaction; a statement that reaches the deadline rejects with
 * {@link DeadlineError}, whose `committing` is false: what runs here is a read (the writes go through
 * {@link inTransaction}), or a seed that repeats harmlessly. It also marks the request's clock `expired`.
 * @param config - Drizzle's query config (text, row mode, type parsers).
 * @param values - The statement's parameters.
 * @returns the driver's result
 */
async function queryWithinDeadline(config: QueryConfig, values?: unknown[]) {
  const clock = requestDeadline.getStore()
  try {
    return await onClientUntil(
      clock?.deadline ?? Date.now() + REQUEST_DEADLINE_MS,
      () => false,
      async (client) => client.query(config, values),
    )
  } catch (error) {
    if (clock && error instanceof DeadlineError) clock.expired = true
    throw error
  }
}

// The pool as drizzle sees it: the pool itself (so a transaction opened on `db` still lends a connection from it), with
// `query` bounded. Drizzle tells a pool from a client by its prototype chain, and calls `query` for a statement and `connect`
// for a transaction.
const boundedPool: Pool = Object.assign(Object.create(pool), {
  query: queryWithinDeadline,
  connect: pool.connect.bind(pool),
})

export const db = drizzle({ client: boundedPool, relations })

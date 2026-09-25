import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgTransactionConfig } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'

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

export const db = drizzle({ client: pool, relations })

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
 * database (the outcome is unknown), or not (the transaction never committed, since the connection was destroyed first).
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
 * Runs `work` in one transaction on a pool connection the call owns, and gives up at `deadline`: the connection is then
 * destroyed (a stuck socket never returns to the pool), its server session is ended with `pg_terminate_backend` so the
 * transaction and the lock it holds go at once ({@link IDLE_IN_TRANSACTION_TIMEOUT_MS} is the fallback when that cannot
 * reach the server), and the call rejects with {@link DeadlineError} without waiting for `work`. A call already past its
 * deadline takes no connection at all.
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
  // A request that spent its budget before this point (a slow session lookup) never takes a connection.
  if (Date.now() >= deadline) throw new DeadlineError(false)
  let expired = false
  let committing = false
  let release: ((error?: Error) => void) | undefined
  let abandon: (() => void) | undefined
  const cutOff = Promise.withResolvers<never>()
  const timer = setTimeout(
    () => {
      expired = true
      abandon?.()
      cutOff.reject(new DeadlineError(committing))
    },
    Math.max(0, deadline - Date.now()),
  )
  const run = async () => {
    const client = await pool.connect()
    let released = false
    // Exactly once, whichever of the deadline and the settled transaction comes first.
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
        void pool
          .query('select pg_terminate_backend($1)', [backendPid])
          .catch(logConnectionError)
    }
    if (expired) {
      release()
      throw new DeadlineError(false)
    }
    try {
      return await drizzle({ client, relations }).transaction(async (tx) => {
        const result = await work(tx)
        // Only COMMIT is left from here: a cut-off now cannot tell whether it landed.
        committing = true
        return result
      }, config)
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

import { addDays, localDay } from '@switch-time/shared'
import { sql } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import { expect, onTestFinished, test, vi } from 'vitest'

import { auth } from '../auth'
import {
  DeadlineError,
  REQUEST_DEADLINE_MS,
  db,
  pool,
  requestDeadline,
} from '../db/client'
import { cookieJar, signIn, signUp, signedIn } from '../test/client'

import { boundedRead, boundedTransaction } from './base'

const TZ = 'Asia/Tokyo'
const today = localDay(new Date(), TZ)

// Sessions of `_test` still running the statement, by its text.
const sessionsRunning = async (statement: string): Promise<number> =>
  (
    await pool.query(
      "select 1 from pg_stat_activity where state = 'active' and query like $1 and pid <> pg_backend_pid()",
      [`%${statement}%`],
    )
  ).rowCount ?? 0

test('a plain read that outlives the request’s deadline is cut off, its database session ends, and the next read is served', async () => {
  // Arrange: a statement the server keeps running after the socket is gone
  const clock = { deadline: Date.now() + 500, expired: false }

  // Act
  const stuck = requestDeadline.run(clock, async () =>
    db.execute(sql`select pg_sleep(31)`),
  )

  // Assert
  // Drizzle wraps what the driver stand-in throws
  await expect(stuck).rejects.toMatchObject({
    cause: expect.any(DeadlineError),
  })
  expect(clock.expired).toBe(true)
  await expect
    .poll(async () => sessionsRunning('pg_sleep(31)'), { timeout: 3_000 })
    .toBe(0)
  await expect(db.execute(sql`select 1 as one`)).resolves.toMatchObject({
    rows: [{ one: 1 }],
  })
})

test('a plain read that starts after the request’s deadline takes no connection', async () => {
  // Arrange
  const clock = { deadline: Date.now() - 1, expired: false }
  let acquired = 0
  const countAcquire = (): void => {
    acquired += 1
  }
  pool.on('acquire', countAcquire)
  onTestFinished(() => {
    pool.off('acquire', countAcquire)
  })

  // Act
  const late = requestDeadline.run(clock, async () => db.execute(sql`select 1`))

  // Assert
  await expect(late).rejects.toMatchObject({ cause: expect.any(DeadlineError) })
  expect(acquired).toBe(0)
})

test('a session lookup stuck on a dead connection is cut off at the request’s deadline, and the clock says so even though Better Auth answers its own 500', async () => {
  // Arrange: the next connection lent never answers a statement, as a half-open socket would not
  await signUp('deadline-session-lookup@example.com')
  const cookie = cookieJar(await signIn('deadline-session-lookup@example.com'))
  const swallowStatements = (client: PoolClient): void => {
    vi.spyOn(client, 'query').mockImplementation(
      async () => new Promise<never>(() => {}),
    )
  }
  pool.once('acquire', swallowStatements)
  const clock = { deadline: Date.now() + 500, expired: false }

  // Act
  const lookup = requestDeadline.run(clock, async () =>
    auth.api.getSession({ headers: new Headers({ cookie }) }),
  )

  // Assert: Better Auth wraps the DeadlineError, so only the clock tells the router's middleware to answer TIMEOUT
  await expect(lookup).rejects.toMatchObject({ statusCode: 500 })
  expect(clock.expired).toBe(true)
  await expect(db.execute(sql`select 1 as one`)).resolves.toMatchObject({
    rows: [{ one: 1 }],
  })
})

test('a fifth multi-query read of one account is refused as busy while four are in flight, and another account’s read is still served', async () => {
  // Arrange: four reads holding their connections
  const api = await signedIn('read-cap-busy@example.com')
  const other = await signedIn('read-cap-other@example.com')
  const { id: userId } = await api.me()
  const holding = Promise.withResolvers<void>()
  const started = Array.from({ length: 4 }, () => Promise.withResolvers<void>())
  const held = started.map(async ({ resolve }) =>
    boundedRead(userId, Date.now() + REQUEST_DEADLINE_MS, async () => {
      resolve()
      await holding.promise
    }),
  )
  onTestFinished(async () => {
    holding.resolve()
    await Promise.all(held)
  })
  await Promise.all(started.map(async ({ promise }) => promise))

  // Act
  const fifth = api.stats.day({ day: today })
  const otherAccount = other.switches.current()

  // Assert
  await expect(fifth).rejects.toMatchObject({
    code: 'TOO_MANY_REQUESTS',
    data: { reason: 'busy' },
  })
  await expect(otherAccount).resolves.toBeNull()
})

test('the account’s reads take their places back once they finish, so its next burst is served', async () => {
  // Arrange: a burst of four reads that fail, then finish
  const api = await signedIn('read-cap-frees@example.com')
  const { id: userId } = await api.me()
  const failing = Array.from({ length: 4 }, async () =>
    boundedRead(userId, Date.now() + REQUEST_DEADLINE_MS, async () => {
      throw new Error('a read that fails')
    }).catch(() => undefined),
  )
  await Promise.all(failing)

  // Act
  const next = api.stats.day({ day: addDays(today, -1) })

  // Assert
  await expect(next).resolves.toBeDefined()
})

test('a write that waits out its lock_timeout answers TIMEOUT, since Postgres rolled it back and nothing was saved', async () => {
  // Arrange: another session holds the lock the write asks for
  const holder = await pool.connect()
  onTestFinished(() => {
    holder.release()
  })
  await holder.query('select pg_advisory_lock(7, 7)')
  onTestFinished(async () => {
    await holder.query('select pg_advisory_unlock(7, 7)')
  })

  // Act
  const waiting = boundedTransaction(
    Date.now() + REQUEST_DEADLINE_MS,
    async (tx) => {
      await tx.execute(sql`set local lock_timeout = '100ms'`)
      await tx.execute(sql`select pg_advisory_xact_lock(7, 7)`)
    },
  )

  // Assert
  await expect(waiting).rejects.toMatchObject({ code: 'TIMEOUT', status: 500 })
})

test('a write that runs past its statement_timeout answers TIMEOUT, since Postgres rolled it back and nothing was saved', async () => {
  // Arrange + Act
  const slow = boundedTransaction(
    Date.now() + REQUEST_DEADLINE_MS,
    async (tx) => {
      await tx.execute(sql`set local statement_timeout = '100ms'`)
      await tx.execute(sql`select pg_sleep(5)`)
    },
  )

  // Assert
  await expect(slow).rejects.toMatchObject({ code: 'TIMEOUT', status: 500 })
})

test('a transaction opened on db, as Better Auth’s adapter opens one, that outlives the request’s deadline is cut off and its database session ends', async () => {
  // Arrange
  const clock = { deadline: Date.now() + 500, expired: false }

  // Act
  const stuck = requestDeadline.run(clock, async () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select pg_sleep(29)`)
    }),
  )

  // Assert
  await expect(stuck).rejects.toBeInstanceOf(DeadlineError)
  expect(clock.expired).toBe(true)
  await expect
    .poll(async () => sessionsRunning('pg_sleep(29)'), { timeout: 3_000 })
    .toBe(0)
})

test('a transaction opened on db that finishes in time returns what its work returned', async () => {
  // Arrange + Act
  const answer = await db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ n: number }>(sql`select 7 as n`)
    return rows[0]?.n
  })

  // Assert
  expect(answer).toBe(7)
})

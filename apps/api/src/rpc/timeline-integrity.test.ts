import { readFileSync } from 'node:fs'

import {
  addDays,
  DAY_ROWS_MAX,
  dayBounds,
  localDay,
  type DayRow,
} from '@switch-time/shared'
import type { PoolClient } from 'pg'
import { afterEach, expect, test, vi } from 'vitest'

import { db, pool } from '../db/client'
import { switches } from '../db/schema/app'
import { signedIn } from '../test/client'

const TZ = 'Asia/Tokyo'
const H = 3_600_000
const MINUTE = 60_000
const today = localDay(new Date(), TZ)
const yesterday = addDays(today, -1)
const dayBefore = addDays(yesterday, -1)
const at = (day: string, hour: number) =>
  new Date(dayBounds(day, TZ).start + hour * H)
const idOf = (list: { id: string; name: string }[], name: string) => {
  const activity = list.find((row) => row.name === name)
  if (!activity) throw new Error(`no activity named ${name}`)
  return activity.id
}
// A listed day's rows as a baseline or 「元に戻す」's `expected` names them, the way the correction sheet sends them.
const listedRows = (rows: DayRow[]): DayRow[] =>
  rows.map(({ id, activityId, startedAt }) => ({ id, activityId, startedAt }))

afterEach(() => {
  vi.useRealTimers()
})

test('元に戻す is refused once another device archived the activity it would put back as the running state, and the edit’s activity keeps running', async () => {
  // Arrange: yesterday's only switch, 仕事 at 9:00, is the running state; device A changes it to 休息 on yesterday's sheet
  const api = await signedIn('archived-undo-running@example.com')
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const rest = idOf(list, '休息')
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: work, startedAt: at(yesterday, 9) }],
  })
  const listed = await api.switches.listByDay({ day: yesterday })
  const [running] = listed.rows
  if (!running) throw new Error('fixture has no row')
  const picked = await api.switches.changeActivity({
    id: running.id,
    activityId: rest,
    baseline: {
      day: yesterday,
      timeZone: TZ,
      rows: listedRows(listed.rows),
      carriedIn: null,
      carriedOutId: null,
    },
  })
  // Device B archives 仕事, which no longer runs
  await api.activities.archive({ id: work })

  // Act: device A's 元に戻す would make 仕事 the running state again
  const undo = api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: listedRows([picked]),
    carriedOutId: null,
    rows: [{ activityId: work, startedAt: at(yesterday, 9) }],
  })

  // Assert
  await expect(undo).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    data: { reason: 'archived' },
  })
  expect(await api.switches.current()).toMatchObject({
    id: running.id,
    activityId: rest,
  })
})

test('元に戻す of a cut is refused when the record it would leave running was changed to an activity archived since', async () => {
  // Arrange: 仕事 from 22:00 the day before runs through yesterday, which has no switch of its own
  const api = await signedIn('archived-undo-cut@example.com')
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const sleep = idOf(list, '睡眠')
  await api.switches.replaceDay({
    day: dayBefore,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: work, startedAt: at(dayBefore, 22) }],
  })
  const listed = await api.switches.listByDay({ day: yesterday })
  if (!listed.carriedIn) throw new Error('fixture has no carried-in record')
  // Device A cuts it at 3:00 yesterday: the new part runs on as 仕事
  const cut = await api.switches.splitAt({
    id: listed.carriedIn.id,
    at: at(yesterday, 3),
    baseline: {
      day: yesterday,
      timeZone: TZ,
      rows: [],
      carriedIn: {
        id: listed.carriedIn.id,
        revision: listed.carriedIn.revision,
      },
      carriedOutId: null,
    },
  })
  // Device B picks 睡眠 for the earlier part on the day before's sheet, then archives 睡眠, which does not run
  const earlier = await api.switches.listByDay({ day: dayBefore })
  const [record] = earlier.rows
  if (!record) throw new Error('fixture has no row')
  await api.switches.changeActivity({
    id: record.id,
    activityId: sleep,
    revision: record.revision,
  })
  await api.activities.archive({ id: sleep })

  // Act: device A's 元に戻す would empty yesterday and leave the 睡眠 record running
  const undo = api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: listedRows([cut]),
    carriedOutId: null,
    rows: [],
  })

  // Assert
  await expect(undo).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    data: { reason: 'archived' },
  })
  expect(await api.switches.current()).toMatchObject({
    id: cut.id,
    activityId: work,
  })
})

// 仕事 from 22:00 the day before runs into yesterday, whose own switch is 食事 at 7:00 (the running state).
async function carriedInDay(email: string) {
  const api = await signedIn(email)
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: dayBefore,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(dayBefore, 22) }],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '食事'), startedAt: at(yesterday, 7) }],
  })
  const listed = await api.switches.listByDay({ day: yesterday })
  const [meal] = listed.rows
  if (!listed.carriedIn || !meal) throw new Error('fixture is incomplete')
  const baseline = {
    day: yesterday,
    timeZone: TZ,
    rows: listedRows(listed.rows),
    carriedIn: {
      id: listed.carriedIn.id,
      revision: listed.carriedIn.revision,
    },
    carriedOutId: null,
  }
  return { api, list, carriedIn: listed.carriedIn, meal, baseline }
}

test('前の記録に統合 into a carried-in record another device changed since the sheet listed it is refused, and nothing is merged', async () => {
  // Arrange: the sheet lists 仕事 running into the day; another device then picks 睡眠 for it on the earlier day's sheet
  const { api, list, carriedIn, meal, baseline } = await carriedInDay(
    'carried-in-changed-merge@example.com',
  )
  await api.switches.changeActivity({
    id: carriedIn.id,
    activityId: idOf(list, '睡眠'),
    revision: carriedIn.revision,
  })

  // Act
  const merge = api.switches.mergeIntoPrevious({ id: meal.id, baseline })

  // Assert: refused as day-changed, and 食事 still starts at 7:00
  await expect(merge).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => [row.id, row.startedAt])).toEqual([
    [meal.id, at(yesterday, 7)],
  ])
})

test('前の記録に統合 into a carried-in record left as the sheet listed it lands, and that record runs on', async () => {
  // Arrange
  const { api, list, carriedIn, meal, baseline } = await carriedInDay(
    'carried-in-unchanged-merge@example.com',
  )

  // Act
  const kept = await api.switches.mergeIntoPrevious({ id: meal.id, baseline })

  // Assert
  expect(kept).toMatchObject({
    id: carriedIn.id,
    activityId: idOf(list, '仕事'),
  })
  expect((await api.switches.listByDay({ day: yesterday })).rows).toEqual([])
})

test('ここで分割 on a carried-in record another device changed since the sheet listed it is refused, and no row is added', async () => {
  // Arrange
  const { api, list, carriedIn, baseline } = await carriedInDay(
    'carried-in-changed-cut@example.com',
  )
  await api.switches.changeActivity({
    id: carriedIn.id,
    activityId: idOf(list, '睡眠'),
    revision: carriedIn.revision,
  })

  // Act
  const cut = api.switches.splitAt({
    id: carriedIn.id,
    at: at(yesterday, 3),
    baseline,
  })

  // Assert
  await expect(cut).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
  expect((await api.switches.listByDay({ day: yesterday })).rows).toHaveLength(
    1,
  )
})

test('an edit made on a day listed with nothing before it is refused once another device wrote a record before the day', async () => {
  // Arrange: yesterday's 食事 at 7:00 is the account's first switch, and the sheet lists no carried-in record
  const api = await signedIn('carried-in-appeared@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '食事'), startedAt: at(yesterday, 7) }],
  })
  const listed = await api.switches.listByDay({ day: yesterday })
  const [meal] = listed.rows
  if (!meal) throw new Error('fixture has no row')
  await api.switches.replaceDay({
    day: dayBefore,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(dayBefore, 22) }],
  })

  // Act
  const move = api.switches.moveStart({
    id: meal.id,
    deltaMinutes: -15,
    baseline: {
      day: yesterday,
      timeZone: TZ,
      rows: listedRows(listed.rows),
      carriedIn: null,
      carriedOutId: null,
    },
  })

  // Assert
  await expect(move).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
})

// Seeds yesterday with `count` switches of 仕事, one minute apart from 1:00, straight into the table (no route writes that
// many in one call), then 家事 from today's 0:00, which ends the day's last row; lists the day as the sheet would.
async function busyDay(email: string, count: number) {
  const api = await signedIn(email)
  const { id: userId } = await api.me()
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const first = at(yesterday, 1).getTime()
  await db.insert(switches).values([
    ...Array.from({ length: count }, (_, index) => ({
      userId,
      activityId: work,
      startedAt: new Date(first + index * MINUTE),
    })),
    { userId, activityId: idOf(list, '家事'), startedAt: at(today, 0) },
  ])
  const listed = await api.switches.listByDay({ day: yesterday })
  if (!listed.carriedOut) throw new Error('fixture has no switch after the day')
  return { api, list, work, listed, carriedOutId: listed.carriedOut.id }
}

test('半分で分割 on the busiest day a baseline can list lands, and its 元に戻す, one row longer, still goes through', async () => {
  // Arrange: the last row runs from 5:59 to midnight, long enough to split
  const { api, work, listed, carriedOutId } = await busyDay(
    'busy-day-split-undo@example.com',
    DAY_ROWS_MAX,
  )
  const last = listed.rows.at(-1)
  if (!last) throw new Error('fixture has no rows')
  const before = listedRows(listed.rows)
  const half = await api.switches.splitInHalf({
    id: last.id,
    baseline: {
      day: yesterday,
      timeZone: TZ,
      rows: before,
      carriedIn: null,
      carriedOutId,
    },
  })

  // Act
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [...before, ...listedRows([half])],
    carriedOutId,
    rows: before.map(({ activityId, startedAt }) => ({
      activityId,
      startedAt,
    })),
  })

  // Assert: the day is back to its 300 rows, the last one still 仕事 from 5:59
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows).toHaveLength(300)
  expect([after.rows.at(-1)?.activityId, after.rows.at(-1)?.startedAt]).toEqual(
    [work, new Date(at(yesterday, 1).getTime() + 299 * MINUTE)],
  )
})

test('an edit on a day busier than a baseline can list lands with a baseline that names no rows', async () => {
  // Arrange
  const { api, list, listed, carriedOutId } = await busyDay(
    'busy-day-rowless-edit@example.com',
    DAY_ROWS_MAX + 1,
  )
  const [first] = listed.rows
  if (!first) throw new Error('fixture has no rows')

  // Act
  const picked = await api.switches.changeActivity({
    id: first.id,
    activityId: idOf(list, '睡眠'),
    baseline: { day: yesterday, timeZone: TZ, carriedIn: null, carriedOutId },
  })

  // Assert
  expect(picked).toMatchObject({
    id: first.id,
    activityId: idOf(list, '睡眠'),
  })
})

test('an edit on a busy day is still refused once the account’s time zone changed, though its baseline names no rows', async () => {
  // Arrange
  const { api, list, listed, carriedOutId } = await busyDay(
    'busy-day-rowless-zone@example.com',
    DAY_ROWS_MAX + 1,
  )
  const [first] = listed.rows
  if (!first) throw new Error('fixture has no rows')
  await api.settings.update({ timeZone: 'Europe/London' })

  // Act
  const pick = api.switches.changeActivity({
    id: first.id,
    activityId: idOf(list, '睡眠'),
    baseline: { day: yesterday, timeZone: TZ, carriedIn: null, carriedOutId },
  })

  // Assert
  await expect(pick).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
})

test('an edit sent with a rowless baseline on a row from another day is refused as bad input', async () => {
  // Arrange: a record the day before, which yesterday's rowless baseline does not cover
  const api = await signedIn('rowless-other-day@example.com')
  const list = await api.activities.list()
  const [record] = await api.switches.replaceDay({
    day: dayBefore,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(dayBefore, 10) }],
  })
  if (!record) throw new Error('seed failed')

  // Act
  const split = api.switches.splitInHalf({
    id: record.id,
    baseline: {
      day: yesterday,
      timeZone: TZ,
      carriedIn: { id: record.id, revision: record.revision },
      carriedOutId: null,
    },
  })

  // Assert
  await expect(split).rejects.toThrow("row is not one of the day's own rows")
})

test('two taps in the same millisecond both land, the second 1 ms after the first, so the timeline keeps one order', async () => {
  // Arrange: the server clock stands still
  const api = await signedIn('same-instant-taps@example.com')
  const list = await api.activities.list()
  const instant = new Date('2026-09-25T03:00:00.000Z')
  vi.useFakeTimers({ toFake: ['Date'], now: instant })

  // Act
  const first = await api.switches.switchTo({ activityId: idOf(list, '仕事') })
  const second = await api.switches.switchTo({ activityId: idOf(list, '休息') })

  // Assert
  expect(first.startedAt).toEqual(new Date('2026-09-25T03:00:00.000Z'))
  expect(second.startedAt).toEqual(new Date('2026-09-25T03:00:00.001Z'))
  expect(await api.switches.current()).toMatchObject({ id: second.id })
})

test('a tap while the running record starts ahead of the server clock starts 1 ms after it, so the tap still becomes the running state', async () => {
  // Arrange: another API instance's clock put 仕事 5 s ahead of this one
  const api = await signedIn('tap-behind-running@example.com')
  const { id: userId } = await api.me()
  const list = await api.activities.list()
  const now = new Date('2026-09-25T03:00:00.000Z')
  vi.useFakeTimers({ toFake: ['Date'], now })
  await db.insert(switches).values({
    userId,
    activityId: idOf(list, '仕事'),
    startedAt: new Date('2026-09-25T03:00:05.000Z'),
  })

  // Act
  const tap = await api.switches.switchTo({ activityId: idOf(list, '休息') })

  // Assert
  expect(tap.startedAt).toEqual(new Date('2026-09-25T03:00:05.001Z'))
  expect(await api.switches.current()).toMatchObject({ id: tap.id })
})

test('the database refuses two switches of one account that start at the same instant', async () => {
  // Arrange
  const api = await signedIn('db-refuses-tie@example.com')
  const { id: userId } = await api.me()
  const list = await api.activities.list()
  const instant = at(yesterday, 9)

  // Act
  const tied = db.insert(switches).values([
    { userId, activityId: idOf(list, '仕事'), startedAt: instant },
    { userId, activityId: idOf(list, '休息'), startedAt: instant },
  ])

  // Assert: the unique index, not another constraint, refuses the pair
  await expect(tied).rejects.toMatchObject({
    cause: { code: '23505', constraint: 'switches_user_started_idx' },
  })
  expect((await api.switches.listByDay({ day: yesterday })).rows).toEqual([])
})

test('an edit sent with a rowless baseline on the first switch after the day is refused as bad input, since the day’s 元に戻す cannot reach it', async () => {
  // Arrange: 家事 from today's 0:00 ends the busy day's last row
  const { api, list, carriedOutId } = await busyDay(
    'rowless-carried-out@example.com',
    DAY_ROWS_MAX + 1,
  )

  // Act
  const pick = api.switches.changeActivity({
    id: carriedOutId,
    activityId: idOf(list, '睡眠'),
    baseline: { day: yesterday, timeZone: TZ, carriedIn: null, carriedOutId },
  })

  // Assert
  await expect(pick).rejects.toThrow("row is not one of the day's own rows")
  expect(
    (await api.switches.listByDay({ day: today })).rows[0]?.activityId,
  ).toBe(idOf(list, '家事'))
})

test('元に戻す of the day’s first row lands after another device changed the carried-in record, and that change survives', async () => {
  // Arrange: the sheet moves 食事 back to 6:45; another device then picks 睡眠 for 仕事, which runs into the day
  const { api, list, carriedIn, meal, baseline } = await carriedInDay(
    'carried-in-survives-undo@example.com',
  )
  const moved = await api.switches.moveStart({
    id: meal.id,
    deltaMinutes: -15,
    baseline,
  })
  const listedAfterMove = await api.switches.listByDay({ day: yesterday })
  if (!listedAfterMove.carriedIn) throw new Error('fixture lost its record')
  await api.switches.changeActivity({
    id: carriedIn.id,
    activityId: idOf(list, '睡眠'),
    revision: listedAfterMove.carriedIn.revision,
  })

  // Act
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: listedRows([moved]),
    carriedOutId: null,
    rows: [{ activityId: idOf(list, '食事'), startedAt: at(yesterday, 7) }],
  })

  // Assert: 食事 starts at 7:00 again, and the carried-in record keeps 睡眠 and now ends there
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => [row.activityId, row.startedAt])).toEqual([
    [idOf(list, '食事'), at(yesterday, 7)],
  ])
  expect(after.carriedIn).toMatchObject({
    id: carriedIn.id,
    activityId: idOf(list, '睡眠'),
  })
})

test('an edit is refused once another device emptied the day before, so the record the sheet listed running into the day is gone', async () => {
  // Arrange: the sheet lists 仕事 from 22:00 the day before running into yesterday; another device then empties the day before
  const { api, carriedIn, meal, baseline } = await carriedInDay(
    'carried-in-gone@example.com',
  )
  await api.switches.replaceDay({
    day: dayBefore,
    timeZone: TZ,
    expected: listedRows([carriedIn]),
    rows: [],
  })

  // Act: -15 min on 食事, which now has nothing before it
  const move = api.switches.moveStart({
    id: meal.id,
    deltaMinutes: -15,
    baseline,
  })

  // Assert: refused as day-changed, and 食事 still starts at 7:00
  await expect(move).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
  expect(
    (await api.switches.listByDay({ day: yesterday })).rows[0]?.startedAt,
  ).toEqual(at(yesterday, 7))
})

test('an edit is refused once another device added a later record to the day before, so a different record now runs into the day', async () => {
  // Arrange: the sheet lists 仕事 from 22:00 the day before; another device adds 休息 at 23:00 on the day before's sheet
  const { api, list, carriedIn, meal, baseline } = await carriedInDay(
    'carried-in-replaced@example.com',
  )
  await api.switches.replaceDay({
    day: dayBefore,
    timeZone: TZ,
    expected: listedRows([carriedIn]),
    carriedOutId: meal.id,
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(dayBefore, 22) },
      { activityId: idOf(list, '休息'), startedAt: at(dayBefore, 23) },
    ],
  })

  // Act
  const move = api.switches.moveStart({
    id: meal.id,
    deltaMinutes: -15,
    baseline,
  })

  // Assert: refused as day-changed, and 食事 still starts at 7:00
  await expect(move).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
  expect(
    (await api.switches.listByDay({ day: yesterday })).rows[0]?.startedAt,
  ).toEqual(at(yesterday, 7))
})

test('元に戻す with nothing after the day still writes back an earlier row on an archived activity, as long as the row left running is live', async () => {
  // Arrange: no switches yet, so 休息 can be archived
  const api = await signedIn('replace-archived-earlier@example.com')
  const list = await api.activities.list()
  const rest = idOf(list, '休息')
  const work = idOf(list, '仕事')
  await api.activities.archive({ id: rest })

  // Act: 休息 at 9:00 is past time; 仕事 at 12:00 becomes the running state
  const written = await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: rest, startedAt: at(yesterday, 9) },
      { activityId: work, startedAt: at(yesterday, 12) },
    ],
  })

  // Assert
  expect(written.map((row) => [row.activityId, row.startedAt])).toEqual([
    [rest, at(yesterday, 9)],
    [work, at(yesterday, 12)],
  ])
  expect(await api.switches.current()).toMatchObject({
    activityId: work,
    startedAt: at(yesterday, 12),
  })
})

test('元に戻す that empties the account’s only day leaves no running state, since there is no record before it to take over', async () => {
  // Arrange: yesterday's 仕事 at 9:00 is the account's only switch
  const api = await signedIn('replace-empty-only-day@example.com')
  const list = await api.activities.list()
  const seeded = await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) }],
  })

  // Act
  const written = await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: listedRows(seeded),
    carriedOutId: null,
    rows: [],
  })

  // Assert
  expect(written).toEqual([])
  expect(await api.switches.current()).toBeNull()
})

// The unique-start migration's first statement: the data step that spreads tied starts before the unique index is built.
const spreadTiesStatement =
  readFileSync(
    new URL(
      '../../drizzle/20260924193844_unique_switch_start/migration.sql',
      import.meta.url,
    ),
    'utf8',
  ).split('--> statement-breakpoint')[0] ?? ''

/**
 * Runs `work` on one pool connection inside a transaction that holds a temporary `switches` without the unique index,
 * which shadows the real table (Postgres searches `pg_temp` first), then rolls everything back. Lets a test feed the
 * migration's data step the ties the real table now refuses.
 */
async function withShadowSwitches(
  work: (connection: PoolClient) => Promise<void>,
): Promise<void> {
  const connection = await pool.connect()
  try {
    await connection.query('begin')
    await connection.query(
      'create temp table switches (like public.switches including defaults) on commit drop',
    )
    await work(connection)
  } finally {
    // Nothing the migration step did may outlive the test: the temporary table goes with the rollback
    await connection.query('rollback')
    connection.release()
  }
}

test('the unique-start migration spreads one account’s tied switches 1 ms apart in the order they were recorded, and leaves other accounts and untied rows alone', async () => {
  await withShadowSwitches(async (connection) => {
    // Arrange: three of user-a's switches tie at 3:00, recorded in the order …3, …1, …2 (not their id order)
    await connection.query(
      `insert into switches (id, user_id, started_at, created_at) values
         ('00000000-0000-4000-8000-000000000001', 'user-a', '2026-09-24T03:00:00.000Z', '2026-09-24T03:00:02Z'),
         ('00000000-0000-4000-8000-000000000002', 'user-a', '2026-09-24T03:00:00.000Z', '2026-09-24T03:00:03Z'),
         ('00000000-0000-4000-8000-000000000003', 'user-a', '2026-09-24T03:00:00.000Z', '2026-09-24T03:00:01Z'),
         ('00000000-0000-4000-8000-000000000004', 'user-a', '2026-09-24T04:00:00.000Z', '2026-09-24T04:00:00Z'),
         ('00000000-0000-4000-8000-000000000005', 'user-b', '2026-09-24T03:00:00.000Z', '2026-09-24T03:00:00Z')`,
    )

    // Act
    await connection.query(spreadTiesStatement)

    // Assert: the first recorded keeps 3:00, the later taps stay later
    const { rows } = await connection.query<{ id: string; started_at: Date }>(
      'select id, started_at from switches order by id',
    )
    expect(rows.map((row) => [row.id, row.started_at])).toEqual([
      [
        '00000000-0000-4000-8000-000000000001',
        new Date('2026-09-24T03:00:00.001Z'),
      ],
      [
        '00000000-0000-4000-8000-000000000002',
        new Date('2026-09-24T03:00:00.002Z'),
      ],
      [
        '00000000-0000-4000-8000-000000000003',
        new Date('2026-09-24T03:00:00.000Z'),
      ],
      [
        '00000000-0000-4000-8000-000000000004',
        new Date('2026-09-24T04:00:00.000Z'),
      ],
      [
        '00000000-0000-4000-8000-000000000005',
        new Date('2026-09-24T03:00:00.000Z'),
      ],
    ])
  })
})

test('the unique-start migration pushes on a switch 1 ms after a tie instead of landing on it, so the unique index can still be built', async () => {
  await withShadowSwitches(async (connection) => {
    // Arrange: two switches tie at 3:00 and a third already starts at 3:00:00.001
    await connection.query(
      `insert into switches (id, user_id, started_at, created_at) values
         ('00000000-0000-4000-8000-000000000001', 'user-a', '2026-09-24T03:00:00.000Z', '2026-09-24T03:00:01Z'),
         ('00000000-0000-4000-8000-000000000002', 'user-a', '2026-09-24T03:00:00.000Z', '2026-09-24T03:00:02Z'),
         ('00000000-0000-4000-8000-000000000003', 'user-a', '2026-09-24T03:00:00.001Z', '2026-09-24T03:00:03Z')`,
    )

    // Act
    await connection.query(spreadTiesStatement)
    const buildIndex = connection.query(
      'create unique index on switches (user_id, started_at desc)',
    )

    // Assert
    await expect(buildIndex).resolves.toBeDefined()
    const { rows } = await connection.query<{ id: string; started_at: Date }>(
      'select id, started_at from switches order by id',
    )
    expect(rows.map((row) => [row.id, row.started_at])).toEqual([
      [
        '00000000-0000-4000-8000-000000000001',
        new Date('2026-09-24T03:00:00.000Z'),
      ],
      [
        '00000000-0000-4000-8000-000000000002',
        new Date('2026-09-24T03:00:00.001Z'),
      ],
      [
        '00000000-0000-4000-8000-000000000003',
        new Date('2026-09-24T03:00:00.002Z'),
      ],
    ])
  })
})

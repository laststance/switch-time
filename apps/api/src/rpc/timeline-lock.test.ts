import { setTimeout as delay } from 'node:timers/promises'

import { addDays, dayBounds, localDay, type DayRow } from '@switch-time/shared'
import { eq } from 'drizzle-orm'
import { expect, onTestFinished, test } from 'vitest'

import { db, pool } from '../db/client'
import { userSettings } from '../db/schema/app'
import { signedIn } from '../test/client'

import { withUserLock } from './base'

const TZ = 'Asia/Tokyo'
const H = 3_600_000
const today = localDay(new Date(), TZ)
const yesterday = addDays(today, -1)
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

/**
 * Takes the user's timeline lock through {@link withUserLock}, as another device's write in flight would, and keeps it until
 * the returned release is awaited (or the test ends, so a failed test never leaves the lock and its queue holding pool
 * connections). Calls made meanwhile queue behind it in the order they arrive.
 */
async function holdTimelineLock(userId: string) {
  const held = Promise.withResolvers<void>()
  const mayRelease = Promise.withResolvers<void>()
  const holder = withUserLock(userId, async () => {
    held.resolve()
    await mayRelease.promise
  })
  await held.promise
  const release = async (): Promise<void> => {
    mayRelease.resolve()
    await holder
  }
  onTestFinished(release)
  return release
}

// Waits until `count` calls are queued on an advisory lock, so the next call is known to queue behind them.
async function waitForLockQueue(count: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const { rows } = await pool.query<{ waiting: number }>(
          `select count(*)::int as waiting from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`,
        )
        return rows[0]?.waiting
      },
      { timeout: 3_000 },
    )
    .toBe(count)
}

test('two devices merging neighbouring records at once hand every span to the record that finally takes it', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00, with a tap on 家事 today so 娯楽 is not the running state
  const api = await signedIn('lock-merge@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  const [work, rest, fun] = (await api.switches.listByDay({ day: yesterday }))
    .rows
  if (!work || !rest || !fun)
    throw new Error('fixture has fewer than three rows')
  const release = await holdTimelineLock(work.userId)

  // Act: one device merges 仕事 into 休息, the other 休息 into 娯楽, while a third write holds the lock
  const first = api.switches.mergeIntoNext({ id: work.id })
  await waitForLockQueue(1)
  const second = api.switches.mergeIntoNext({ id: rest.id })
  await waitForLockQueue(2)
  await release()
  await Promise.all([first, second])

  // Assert: the second merge read the neighbours the first left, so 娯楽 now starts at 9:00 and nothing else remains
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => [row.id, row.startedAt])).toEqual([
    [fun.id, at(yesterday, 9)],
  ])
})

test('a tap on an activity queued behind its archive is refused, so an archived activity never starts running', async () => {
  // Arrange: 仕事 is running, so 休息 may be archived
  const api = await signedIn('lock-archive-first@example.com')
  const list = await api.activities.list()
  const running = await api.switches.switchTo({
    activityId: idOf(list, '仕事'),
  })
  const release = await holdTimelineLock(running.userId)

  // Act: the archive of 休息 queues first, the tap on 休息 second
  const archive = api.activities.archive({ id: idOf(list, '休息') })
  await waitForLockQueue(1)
  const tap = api.switches.switchTo({ activityId: idOf(list, '休息') })
  await waitForLockQueue(2)
  await release()

  // Assert: archived, the tap refused as archived, and 仕事 still runs
  await expect(archive).resolves.toMatchObject({ archivedAt: expect.any(Date) })
  await expect(tap).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  expect(await api.switches.current()).toMatchObject({ id: running.id })
})

test('an activity change queued behind the archive of that activity is refused, so no record takes an archived activity', async () => {
  // Arrange: 仕事 is running
  const api = await signedIn('lock-pick-archive@example.com')
  const list = await api.activities.list()
  const running = await api.switches.switchTo({
    activityId: idOf(list, '仕事'),
  })
  const release = await holdTimelineLock(running.userId)

  // Act: the archive of 休息 queues first, the change of the running record to 休息 second
  const archive = api.activities.archive({ id: idOf(list, '休息') })
  await waitForLockQueue(1)
  const pick = api.switches.changeActivity({
    id: running.id,
    activityId: idOf(list, '休息'),
  })
  await waitForLockQueue(2)
  await release()

  // Assert: archived, the change refused as archived, and 仕事 still runs
  await expect(archive).resolves.toMatchObject({ archivedAt: expect.any(Date) })
  await expect(pick).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    data: { reason: 'archived' },
  })
  expect(await api.switches.current()).toMatchObject({
    activityId: idOf(list, '仕事'),
  })
})

test('two archives of the last two live activities at once leave one live, so the clock always has one to switch to', async () => {
  // Arrange: detox runs (no activity is the running state); every activity but 食事 and 娯楽 is archived
  const api = await signedIn('lock-archive-last-two@example.com')
  const list = await api.activities.list()
  const running = await api.switches.switchTo({ activityId: null })
  for (const name of ['家事', '仕事', '休息', '睡眠'])
    await api.activities.archive({ id: idOf(list, name) })
  const release = await holdTimelineLock(running.userId)

  // Act: both archives queue behind the lock
  const first = api.activities.archive({ id: idOf(list, '食事') })
  await waitForLockQueue(1)
  const second = api.activities.archive({ id: idOf(list, '娯楽') })
  await waitForLockQueue(2)
  await release()
  const outcomes = await Promise.allSettled([first, second])

  // Assert: the first lands, the second is refused, and 娯楽 stays live
  expect(outcomes.map((outcome) => outcome.status)).toEqual([
    'fulfilled',
    'rejected',
  ])
  const live = (await api.activities.list()).filter(
    (row) => row.archivedAt === null,
  )
  expect(live.map((row) => row.name)).toEqual(['娯楽'])
})

test('a 15-minute move waits for a switch write in flight, so it lands next to the neighbours that write left', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, with a tap on 家事 today so 休息 has a later state
  const api = await signedIn('lock-move@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
    ],
  })
  await api.switches.switchTo({ activityId: idOf(list, '家事') })
  const [, rest] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!rest) throw new Error('fixture has no second row')
  const release = await holdTimelineLock(rest.userId)

  // Act
  const move = api.switches.moveStart({ id: rest.id, deltaMinutes: 15 })
  await waitForLockQueue(1)
  await release()

  // Assert
  await expect(move).resolves.toMatchObject({
    startedAt: at(yesterday, 12.25),
  })
})

test('an archive queued behind a tap on its activity is refused, because that activity is now the running state', async () => {
  // Arrange: 仕事 is running
  const api = await signedIn('lock-tap-first@example.com')
  const list = await api.activities.list()
  const running = await api.switches.switchTo({
    activityId: idOf(list, '仕事'),
  })
  const release = await holdTimelineLock(running.userId)

  // Act: the tap on 休息 queues first, the archive of 休息 second
  const tap = api.switches.switchTo({ activityId: idOf(list, '休息') })
  await waitForLockQueue(1)
  const archive = api.activities.archive({ id: idOf(list, '休息') })
  await waitForLockQueue(2)
  await release()

  // Assert: 休息 runs and stays live
  await expect(tap).resolves.toMatchObject({ activityId: idOf(list, '休息') })
  await expect(archive).rejects.toMatchObject({ code: 'CONFLICT' })
  const rest = (await api.activities.list()).find(
    (row) => row.id === idOf(list, '休息'),
  )
  expect(rest?.archivedAt).toBeNull()
})

test('two 元に戻す of one day at once restore it once: the second is refused and no row is written twice', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00; 休息 merged into 仕事, which arms the same undo in two tabs
  const api = await signedIn('lock-undo-twice@example.com')
  const list = await api.activities.list()
  const snapshot = [
    { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
    { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
  ]
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: snapshot,
  })
  const [, rest] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!rest) throw new Error('fixture has no second row')
  await api.switches.mergeIntoPrevious({ id: rest.id })
  const merged = await api.switches.listByDay({ day: yesterday })
  const undo = {
    day: yesterday,
    timeZone: TZ,
    expected: listedRows(merged.rows),
    rows: snapshot,
  }
  const release = await holdTimelineLock(rest.userId)

  // Act
  const firstTab = api.switches.replaceDay(undo)
  await waitForLockQueue(1)
  const secondTab = api.switches.replaceDay(undo)
  await waitForLockQueue(2)
  await release()
  const outcomes = await Promise.allSettled([firstTab, secondTab])

  // Assert: one restored the day, the other found it changed; the day holds the two rows once
  expect(outcomes.map((outcome) => outcome.status)).toEqual([
    'fulfilled',
    'rejected',
  ])
  await expect(secondTab).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => [row.activityId, row.startedAt])).toEqual(
    snapshot.map((row) => [row.activityId, row.startedAt]),
  )
})

test('a time-zone change waits for a switch write in flight, so no write reads a window the zone is moving', async () => {
  // Arrange
  const api = await signedIn('lock-zone@example.com')
  const running = await api.switches.switchTo({
    activityId: idOf(await api.activities.list(), '仕事'),
  })
  const release = await holdTimelineLock(running.userId)

  // Act
  const zoneChange = api.settings.update({ timeZone: 'America/New_York' })
  await waitForLockQueue(1)
  await release()

  // Assert
  await expect(zoneChange).resolves.toMatchObject({
    timeZone: 'America/New_York',
  })
})

test('an edit made on the day as the sheet listed it lands', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00
  const api = await signedIn('baseline-ok@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
    ],
  })
  const listed = await api.switches.listByDay({ day: yesterday })
  const [, rest] = listed.rows
  if (!rest) throw new Error('fixture has no second row')

  // Act
  const moved = await api.switches.moveStart({
    id: rest.id,
    deltaMinutes: 15,
    baseline: { day: yesterday, timeZone: TZ, rows: listedRows(listed.rows) },
  })

  // Assert
  expect(moved.startedAt).toEqual(at(yesterday, 12.25))
})

test('an edit made on a list that another device has since changed is refused, and nothing is written', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00 as the sheet listed them; then another device changes 仕事 to 家事 in place
  const api = await signedIn('baseline-stale@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
    ],
  })
  const listed = await api.switches.listByDay({ day: yesterday })
  const [work, rest] = listed.rows
  if (!work || !rest) throw new Error('fixture has fewer than two rows')
  await api.switches.changeActivity({
    id: work.id,
    activityId: idOf(list, '家事'),
  })

  // Act: the sheet, still showing 仕事, merges 休息 into it
  const merge = api.switches.mergeIntoPrevious({
    id: rest.id,
    baseline: { day: yesterday, timeZone: TZ, rows: listedRows(listed.rows) },
  })

  // Assert: refused as a changed day, and both rows are still there
  await expect(merge).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => row.id)).toEqual([work.id, rest.id])
})

test('an edit made on a list missing a switch another device added is refused', async () => {
  // Arrange: today's sheet lists only 仕事; then another device taps 休息
  const api = await signedIn('baseline-added@example.com')
  const list = await api.activities.list()
  await api.switches.switchTo({ activityId: idOf(list, '仕事') })
  const listed = await api.switches.listByDay({ day: today })
  const [work] = listed.rows
  if (!work) throw new Error('fixture has no row')
  await api.switches.switchTo({ activityId: idOf(list, '休息') })

  // Act
  const pick = api.switches.changeActivity({
    id: work.id,
    activityId: idOf(list, '家事'),
    baseline: { day: today, timeZone: TZ, rows: listedRows(listed.rows) },
  })

  // Assert
  await expect(pick).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
  expect((await api.switches.listByDay({ day: today })).rows[0]).toMatchObject({
    id: work.id,
    activityId: idOf(list, '仕事'),
  })
})

test('an edit made under a time zone the account no longer uses is refused', async () => {
  // Arrange: the sheet listed yesterday in Tokyo; the other device's zone is written since
  const api = await signedIn('baseline-zone@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
    ],
  })
  const listed = await api.switches.listByDay({ day: yesterday })
  const [work] = listed.rows
  if (!work) throw new Error('fixture has no row')
  await api.settings.update({ timeZone: 'Europe/London' })

  // Act
  const split = api.switches.splitInHalf({
    id: work.id,
    baseline: { day: yesterday, timeZone: TZ, rows: listedRows(listed.rows) },
  })

  // Assert
  await expect(split).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
  expect((await api.switches.listByDay({ day: yesterday })).rows).toHaveLength(
    2,
  )
})

test('a move that would take the day’s first row onto the day before is refused when the sheet names its day', async () => {
  // Arrange: 睡眠 from the day before runs into yesterday, whose first row is 仕事 at 0:05
  const api = await signedIn('baseline-window@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: addDays(yesterday, -1),
    timeZone: TZ,
    expected: [],
    rows: [
      {
        activityId: idOf(list, '睡眠'),
        startedAt: at(addDays(yesterday, -1), 22),
      },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 5 / 60) },
    ],
  })
  const listed = await api.switches.listByDay({ day: yesterday })
  const [work] = listed.rows
  if (!work) throw new Error('fixture has no row')

  // Act: -15 min would start 仕事 at 23:50 the day before
  const move = api.switches.moveStart({
    id: work.id,
    deltaMinutes: -15,
    baseline: { day: yesterday, timeZone: TZ, rows: listedRows(listed.rows) },
  })

  // Assert: refused, 仕事 still starts at 0:05
  await expect(move).rejects.toThrow('no room to move')
  expect(
    (await api.switches.listByDay({ day: yesterday })).rows[0]?.startedAt,
  ).toEqual(at(yesterday, 5 / 60))
})

test('元に戻す is refused once another device has switched on that day since the edit, and that switch survives', async () => {
  // Arrange: today 仕事 then 休息 (running); 休息 is merged into 仕事, arming the undo; then another device taps 娯楽
  const api = await signedIn('undo-foreign@example.com')
  const list = await api.activities.list()
  await api.switches.switchTo({ activityId: idOf(list, '仕事') })
  await api.switches.switchTo({ activityId: idOf(list, '休息') })
  const before = await api.switches.listByDay({ day: today })
  const [, rest] = before.rows
  if (!rest) throw new Error('fixture has no second row')
  await api.switches.mergeIntoPrevious({ id: rest.id })
  const merged = await api.switches.listByDay({ day: today })
  const fun = await api.switches.switchTo({ activityId: idOf(list, '娯楽') })

  // Act
  const undo = api.switches.replaceDay({
    day: today,
    timeZone: TZ,
    expected: listedRows(merged.rows),
    rows: before.rows.map(({ activityId, startedAt }) => ({
      activityId,
      startedAt,
    })),
  })

  // Assert: refused, and 娯楽 still runs
  await expect(undo).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
  expect(await api.switches.current()).toMatchObject({ id: fun.id })
})

test('元に戻す is refused once another device has moved a row of that day in place', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00; 娯楽 merged into 休息; then another device moves 仕事 to 9:15
  const api = await signedIn('undo-in-place@example.com')
  const list = await api.activities.list()
  const snapshot = [
    { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
    { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
    { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
  ]
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: snapshot,
  })
  const [work, , fun] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!work || !fun) throw new Error('fixture has fewer than three rows')
  await api.switches.mergeIntoPrevious({ id: fun.id })
  const merged = await api.switches.listByDay({ day: yesterday })
  await api.switches.moveStart({ id: work.id, deltaMinutes: 15 })

  // Act
  const undo = api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: listedRows(merged.rows),
    rows: snapshot,
  })

  // Assert: refused, and the move is kept
  await expect(undo).rejects.toMatchObject({ code: 'CONFLICT' })
  expect(
    (await api.switches.listByDay({ day: yesterday })).rows[0]?.startedAt,
  ).toEqual(at(yesterday, 9.25))
})

test('元に戻す is refused once the account’s time zone has changed since the edit', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00; 休息 merged into 仕事; then the zone flips to London
  const api = await signedIn('undo-zone@example.com')
  const list = await api.activities.list()
  const snapshot = [
    { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
    { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
  ]
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: snapshot,
  })
  const [, rest] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!rest) throw new Error('fixture has no second row')
  await api.switches.mergeIntoPrevious({ id: rest.id })
  const merged = await api.switches.listByDay({ day: yesterday })
  await api.settings.update({ timeZone: 'Europe/London' })

  // Act
  const undo = api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: listedRows(merged.rows),
    rows: snapshot,
  })

  // Assert
  await expect(undo).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
})

// Whether `call` settles within two seconds: long enough for a call that never waits, short enough to catch one that does.
async function settlesWithoutWaiting(call: Promise<unknown>): Promise<boolean> {
  return Promise.race([call.then(() => true), delay(2_000).then(() => false)])
}

test('a settings change that leaves the time zone alone does not wait for a switch write in flight', async () => {
  // Arrange
  const api = await signedIn('lock-theme@example.com')
  const running = await api.switches.switchTo({
    activityId: idOf(await api.activities.list(), '仕事'),
  })
  const release = await holdTimelineLock(running.userId)

  // Act
  const themeChange = api.settings.update({ theme: 'dark' })
  const landedWhileLocked = await settlesWithoutWaiting(themeChange)
  await release()

  // Assert
  expect(landedWhileLocked).toBe(true)
  await expect(themeChange).resolves.toMatchObject({ theme: 'dark' })
})

test('one account’s switch write in flight never holds up another account’s tap', async () => {
  // Arrange
  const owner = await signedIn('lock-owner@example.com')
  const other = await signedIn('lock-other@example.com')
  const running = await owner.switches.switchTo({
    activityId: idOf(await owner.activities.list(), '仕事'),
  })
  const otherList = await other.activities.list()
  const release = await holdTimelineLock(running.userId)

  // Act
  const tap = other.switches.switchTo({ activityId: idOf(otherList, '休息') })
  const landedWhileLocked = await settlesWithoutWaiting(tap)
  await release()

  // Assert
  expect(landedWhileLocked).toBe(true)
  await expect(tap).resolves.toMatchObject({
    activityId: idOf(otherList, '休息'),
  })
})

test('merging into the next record on a list another device has since changed is refused, and nothing is written', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00 as the sheet listed them; then another device moves 娯楽 to 18:15
  const api = await signedIn('baseline-merge-next@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  const listed = await api.switches.listByDay({ day: yesterday })
  const [, rest, fun] = listed.rows
  if (!rest || !fun) throw new Error('fixture has fewer than three rows')
  await api.switches.moveStart({ id: fun.id, deltaMinutes: 15 })

  // Act
  const merge = api.switches.mergeIntoNext({
    id: rest.id,
    baseline: { day: yesterday, timeZone: TZ, rows: listedRows(listed.rows) },
  })

  // Assert: refused as a changed day; 休息 is still there and 娯楽 keeps the other device's 18:15
  await expect(merge).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => row.startedAt)).toEqual([
    at(yesterday, 9),
    at(yesterday, 12),
    at(yesterday, 18.25),
  ])
})

test('ここで分割 on a list another device has since changed is refused, and no row is added', async () => {
  // Arrange: 仕事 from 22:00 the day before runs into yesterday, whose own row is 食事 at 7:00; then another device turns 食事 into 家事
  const api = await signedIn('baseline-cut@example.com')
  const list = await api.activities.list()
  const dayBefore = addDays(yesterday, -1)
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
  await api.switches.changeActivity({
    id: meal.id,
    activityId: idOf(list, '家事'),
  })

  // Act
  const cut = api.switches.splitAt({
    id: listed.carriedIn.id,
    at: at(yesterday, 3),
    baseline: { day: yesterday, timeZone: TZ, rows: listedRows(listed.rows) },
  })

  // Assert
  await expect(cut).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'day-changed' },
  })
  expect(
    (await api.switches.listByDay({ day: yesterday })).rows.map(
      (row) => row.activityId,
    ),
  ).toEqual([idOf(list, '家事')])
})

test('a move that would take the day’s last row past its midnight is refused when the sheet names its day', async () => {
  // Arrange: the day before yesterday ends on 仕事 at 23:50, and yesterday starts on 休息 at 6:00
  const api = await signedIn('baseline-window-end@example.com')
  const list = await api.activities.list()
  const dayBefore = addDays(yesterday, -1)
  await api.switches.replaceDay({
    day: dayBefore,
    timeZone: TZ,
    expected: [],
    rows: [
      {
        activityId: idOf(list, '仕事'),
        startedAt: at(dayBefore, 23 + 50 / 60),
      },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '休息'), startedAt: at(yesterday, 6) }],
  })
  const listed = await api.switches.listByDay({ day: dayBefore })
  const [work] = listed.rows
  if (!work) throw new Error('fixture has no row')

  // Act: +15 min would start 仕事 at 0:05 yesterday
  const move = api.switches.moveStart({
    id: work.id,
    deltaMinutes: 15,
    baseline: { day: dayBefore, timeZone: TZ, rows: listedRows(listed.rows) },
  })

  // Assert: refused, 仕事 still starts at 23:50 on its own day
  await expect(move).rejects.toThrow('no room to move')
  expect(
    (await api.switches.listByDay({ day: dayBefore })).rows[0]?.startedAt,
  ).toEqual(at(dayBefore, 23 + 50 / 60))
})

test('半分で分割 is refused when the half-way point falls on the next day, so the new row never leaves the sheet’s day', async () => {
  // Arrange: the day before yesterday ends on 仕事 at 20:00, and yesterday starts on 休息 at 6:00 (midpoint 1:00 yesterday)
  const api = await signedIn('baseline-split-midpoint@example.com')
  const list = await api.activities.list()
  const dayBefore = addDays(yesterday, -1)
  await api.switches.replaceDay({
    day: dayBefore,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(dayBefore, 20) }],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '休息'), startedAt: at(yesterday, 6) }],
  })
  const listed = await api.switches.listByDay({ day: dayBefore })
  const [work] = listed.rows
  if (!work) throw new Error('fixture has no row')

  // Act
  const split = api.switches.splitInHalf({
    id: work.id,
    baseline: { day: dayBefore, timeZone: TZ, rows: listedRows(listed.rows) },
  })

  // Assert: refused, and yesterday still holds only 休息
  await expect(split).rejects.toThrow('midpoint is on another day')
  expect(
    (await api.switches.listByDay({ day: yesterday })).rows.map(
      (row) => row.activityId,
    ),
  ).toEqual([idOf(list, '休息')])
})

test('ここで分割 at a time before the sheet’s day is refused, so the cut never lands on the earlier day', async () => {
  // Arrange: 仕事 from 22:00 the day before runs into yesterday, whose own row is 食事 at 7:00
  const api = await signedIn('baseline-cut-window@example.com')
  const list = await api.activities.list()
  const dayBefore = addDays(yesterday, -1)
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
  if (!listed.carriedIn) throw new Error('fixture has no carried-in record')

  // Act: 23:00 is inside the record, but on the day before the sheet's
  const cut = api.switches.splitAt({
    id: listed.carriedIn.id,
    at: at(dayBefore, 23),
    baseline: { day: yesterday, timeZone: TZ, rows: listedRows(listed.rows) },
  })

  // Assert
  await expect(cut).rejects.toThrow('no room to split there')
  expect(
    (await api.switches.listByDay({ day: dayBefore })).rows.map(
      (row) => row.startedAt,
    ),
  ).toEqual([at(dayBefore, 22)])
})

test('元に戻す of a cut on a day with no switch of its own empties the day again and the carried-in record runs through it', async () => {
  // Arrange: 仕事 from 22:00 the day before is still running; yesterday is cut at 3:00 from its sheet
  const api = await signedIn('undo-empty-day@example.com')
  const list = await api.activities.list()
  const dayBefore = addDays(yesterday, -1)
  const [work] = await api.switches.replaceDay({
    day: dayBefore,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(dayBefore, 22) }],
  })
  if (!work) throw new Error('fixture has no row')
  const inserted = await api.switches.splitAt({
    id: work.id,
    at: at(yesterday, 3),
    baseline: { day: yesterday, timeZone: TZ, rows: [] },
  })

  // Act
  const written = await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: listedRows([inserted]),
    rows: [],
  })

  // Assert
  expect(written).toEqual([])
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows).toEqual([])
  expect(after.carriedIn?.id).toBe(work.id)
})

test('a rewritten day with a row outside that day is refused as bad input, and the day stays as it was', async () => {
  // Arrange: yesterday 仕事 9:00
  const api = await signedIn('replace-outside@example.com')
  const list = await api.activities.list()
  const listed = await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) }],
  })

  // Act: the second row starts at 9:00 the day after
  const replacement = api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: listedRows(listed),
    rows: [
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 10) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 33) },
    ],
  })

  // Assert
  await expect(replacement).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  expect(
    (await api.switches.listByDay({ day: yesterday })).rows.map(
      (row) => row.activityId,
    ),
  ).toEqual([idOf(list, '仕事')])
})

test('an edit on an account whose settings row is missing still lands: the day check repairs the row first', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00 listed by the sheet; then the settings row goes missing
  const api = await signedIn('baseline-unseeded@example.com')
  const { id: userId } = await api.me()
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
    ],
  })
  const listed = await api.switches.listByDay({ day: yesterday })
  const [, rest] = listed.rows
  if (!rest) throw new Error('fixture has no second row')
  await db.delete(userSettings).where(eq(userSettings.userId, userId))

  // Act
  const moved = await api.switches.moveStart({
    id: rest.id,
    deltaMinutes: 15,
    baseline: { day: yesterday, timeZone: TZ, rows: listedRows(listed.rows) },
  })

  // Assert: the default zone (Asia/Tokyo) matched the sheet's
  expect(moved.startedAt).toEqual(at(yesterday, 12.25))
  expect((await api.settings.get()).timeZone).toBe(TZ)
})

test('the last live activity cannot be archived, so the clock always has one to switch to', async () => {
  // Arrange: no switch yet; every activity but 娯楽 is archived
  const api = await signedIn('archive-last@example.com')
  const list = await api.activities.list()
  for (const name of ['家事', '仕事', '休息', '睡眠', '食事'])
    await api.activities.archive({ id: idOf(list, name) })

  // Act
  const archive = api.activities.archive({ id: idOf(list, '娯楽') })

  // Assert
  await expect(archive).rejects.toMatchObject({ code: 'CONFLICT' })
  const fun = (await api.activities.list()).find(
    (row) => row.id === idOf(list, '娯楽'),
  )
  expect(fun?.archivedAt).toBeNull()
})

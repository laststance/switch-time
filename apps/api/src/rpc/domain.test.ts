import { addDays, dayBounds, localDay, type DayRow } from '@switch-time/shared'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'

import { db, pool } from '../db/client'
import { activities, switches, userSettings } from '../db/schema/app'
import { signedIn } from '../test/client'

const TZ = 'Asia/Tokyo'
const H = 3_600_000
const today = localDay(new Date(), TZ)
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

test('sign-up seeds 6 activities and settings', async () => {
  // Arrange
  const api = await signedIn('seed@example.com')

  // Act
  const [list, settings] = await Promise.all([
    api.activities.list(),
    api.settings.get(),
  ])

  // Assert
  expect(
    list.map((row) => [row.name, row.color, row.targetHours, row.position]),
  ).toEqual([
    ['家事', '#E0A431', 1.5, 0],
    ['仕事', '#3B7BD9', 8, 1],
    ['休息', '#4FA877', 2, 2],
    ['睡眠', '#6C63D6', 7, 3],
    ['食事', '#E0684A', 1.5, 4],
    ['娯楽', '#D8579C', 1.5, 5],
  ])
  expect(settings).toMatchObject({
    theme: 'auto',
    showSecondHand: true,
    idleThresholdMinutes: 720,
    autoExcludeUnusedDays: true,
    timeZone: 'Asia/Tokyo',
  })
})

test('switching creates a new current state and never leaves zero states', async () => {
  // Arrange
  const api = await signedIn('switch@example.com')
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const rest = idOf(list, '休息')
  expect(await api.switches.current()).toBeNull()

  // Act
  const first = await api.switches.switchTo({ activityId: work })
  const again = await api.switches.switchTo({ activityId: work })
  const second = await api.switches.switchTo({ activityId: rest })

  // Assert
  expect(first).toMatchObject({ activityId: work, source: 'tap' })
  expect(again.id).toBe(first.id)
  expect((await api.switches.current())?.id).toBe(second.id)
  await expect(
    api.switches.mergeIntoPrevious({ id: first.id }),
  ).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'no-neighbour' },
  })
  await expect(api.activities.archive({ id: rest })).rejects.toMatchObject({
    code: 'CONFLICT',
  })
})

test('a day without switches counts as unmeasured and breaks the streak', async () => {
  // Arrange: taps two days ago and today, nothing yesterday
  const api = await signedIn('streak@example.com')
  const work = idOf(await api.activities.list(), '仕事')
  const twoDaysAgo = addDays(today, -2)
  await api.switches.replaceDay({
    day: twoDaysAgo,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: work, startedAt: at(twoDaysAgo, 9) }],
  })
  await api.switches.replaceDay({
    day: today,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: work, startedAt: at(today, 0) }],
  })

  // Act
  const week = await api.stats.week({ startDay: addDays(today, -6) })

  // Assert
  expect(week.days.map((day) => [day.measured, day.excluded])).toEqual([
    [false, null],
    [false, null],
    [false, null],
    [false, null],
    [true, null],
    [false, 'auto_unused'],
    [true, null],
  ])
  expect(week.streak).toBe(1)
  expect(week.measuredDays).toBe(2)
  expect(week.excludedDays).toEqual([
    { day: addDays(today, -1), reason: 'auto_unused' },
  ])
})

test('the week view gets totals over measured days only, with the unused day listed as excluded', async () => {
  // Arrange: 仕事 9 h three days ago, then 休息 through the untouched day (idle), 仕事 10 h + 娯楽 6 h yesterday, 睡眠 since midnight.
  const api = await signedIn('history@example.com')
  const list = await api.activities.list()
  const threeDaysAgo = addDays(today, -3)
  const yesterday = addDays(today, -1)
  await api.switches.replaceDay({
    day: threeDaysAgo,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(threeDaysAgo, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(threeDaysAgo, 18) },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 8) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  await api.switches.replaceDay({
    day: today,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '睡眠'), startedAt: at(today, 0) }],
  })

  // Act
  const week = await api.stats.week({ startDay: addDays(today, -7) })

  // Assert
  expect(week.totals).toEqual({
    [idOf(list, '仕事')]: 19 * H,
    [idOf(list, '娯楽')]: 6 * H,
  })
  expect(week.measuredDays).toBe(2)
  expect(week.streak).toBe(2)
  expect(week.excludedDays).toEqual([
    { day: addDays(today, -2), reason: 'auto_unused' },
  ])
  // 1日あたり on the screen is total ÷ measured days: 9h 30m of 仕事, not the 6h 20m a three-day calendar span would give.
  expect((week.totals[idOf(list, '仕事')] ?? 0) / week.measuredDays).toBe(
    9.5 * H,
  )
})

test('a segment longer than the idle threshold is excluded from the day total', async () => {
  // Arrange: two days ago 00:00 仕事 (13h → idle), 13:00 休息 (2h), 15:00 食事 (9h, closed by yesterday's 00:00 睡眠)
  const api = await signedIn('idle@example.com')
  const list = await api.activities.list()
  const day = addDays(today, -2)
  const yesterday = addDays(today, -1)
  await api.switches.replaceDay({
    day,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(day, 0) },
      { activityId: idOf(list, '休息'), startedAt: at(day, 13) },
      { activityId: idOf(list, '食事'), startedAt: at(day, 15) },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '睡眠'), startedAt: at(yesterday, 0) }],
  })

  // Act
  const stats = await api.stats.day({ day })

  // Assert
  expect(stats.totals).toEqual({
    [idOf(list, '休息')]: 7_200_000,
    [idOf(list, '食事')]: 32_400_000,
  })
  expect(stats.days[0]).toMatchObject({
    day,
    measured: true,
    excluded: null,
    idleMs: 46_800_000,
  })
  expect(stats.streak).toBe(2)
})

test('switching to detox creates a state with no activity and pressing it again keeps the row', async () => {
  // Arrange
  const api = await signedIn('detox@example.com')
  const work = idOf(await api.activities.list(), '仕事')
  await api.switches.switchTo({ activityId: work })

  // Act
  const detox = await api.switches.switchTo({ activityId: null })
  const again = await api.switches.switchTo({ activityId: null })

  // Assert
  expect(detox).toMatchObject({ activityId: null, source: 'tap' })
  expect(again.id).toBe(detox.id)
  expect((await api.switches.current())?.id).toBe(detox.id)
})

test('detox time is left out of every total while the day stays measured', async () => {
  // Arrange: two days ago 9:00 仕事, 12:00 detox, 15:00 休息 (9h, closed by yesterday's 00:00 睡眠)
  const api = await signedIn('detox-stats@example.com')
  const list = await api.activities.list()
  const day = addDays(today, -2)
  const yesterday = addDays(today, -1)
  await api.switches.replaceDay({
    day,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(day, 9) },
      { activityId: null, startedAt: at(day, 12) },
      { activityId: idOf(list, '休息'), startedAt: at(day, 15) },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '睡眠'), startedAt: at(yesterday, 0) }],
  })

  // Act
  const [stats, listed] = await Promise.all([
    api.stats.day({ day }),
    api.switches.listByDay({ day }),
  ])

  // Assert: the detox row is stored and listed, but its 3h are in no total and are not idle either
  expect(listed.rows.map((row) => row.activityId)).toEqual([
    idOf(list, '仕事'),
    null,
    idOf(list, '休息'),
  ])
  expect(stats.totals).toEqual({
    [idOf(list, '仕事')]: 10_800_000,
    [idOf(list, '休息')]: 32_400_000,
  })
  expect(stats.days[0]).toMatchObject({
    day,
    measured: true,
    idleMs: 0,
    detoxMs: 10_800_000,
  })
})

test('a segment can be corrected onto detox and back', async () => {
  // Arrange
  const api = await signedIn('detox-correction@example.com')
  const work = idOf(await api.activities.list(), '仕事')
  const row = await api.switches.switchTo({ activityId: work })

  // Act
  const detoxed = await api.switches.changeActivity({
    id: row.id,
    activityId: null,
  })
  const restored = await api.switches.changeActivity({
    id: row.id,
    activityId: work,
  })

  // Assert
  expect(detoxed).toMatchObject({
    id: row.id,
    activityId: null,
    source: 'correction',
  })
  expect(restored).toMatchObject({ id: row.id, activityId: work })
})

test('a day spent entirely in detox is measured and lists its tap, with nothing to total', async () => {
  // Arrange: two days ago a single tap, detox at 9:00; 睡眠 from 0:00 the next day closes it (15 h, over the idle threshold)
  const api = await signedIn('detox-only-day@example.com')
  const list = await api.activities.list()
  const day = addDays(today, -2)
  const dayAfter = addDays(today, -1)
  await api.switches.replaceDay({
    day,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: null, startedAt: at(day, 9) }],
  })
  await api.switches.replaceDay({
    day: dayAfter,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '睡眠'), startedAt: at(dayAfter, 0) }],
  })

  // Act
  const [stats, listed] = await Promise.all([
    api.stats.day({ day }),
    api.switches.listByDay({ day }),
  ])

  // Assert: the tap makes the day measured and its 15 h are detox, in no total and not idle either
  expect(stats.days[0]).toMatchObject({
    day,
    measured: true,
    totals: {},
    idleMs: 0,
    detoxMs: 54_000_000,
  })
  expect(stats.measuredDays).toBe(1)
  expect(listed.rows.map((row) => row.activityId)).toEqual([null])
})

test('switching to an archived activity is refused', async () => {
  // Arrange: 仕事 is the current state, so 休息 can be archived
  const api = await signedIn('switch-archived@example.com')
  const list = await api.activities.list()
  const rest = idOf(list, '休息')
  await api.switches.switchTo({ activityId: idOf(list, '仕事') })
  await api.activities.archive({ id: rest })

  // Act + Assert
  await expect(
    api.switches.switchTo({ activityId: rest }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
})

test('detox frees the previous state’s activity for archiving', async () => {
  // Arrange: 仕事 then detox, so the current state has no activity for the archive guard to protect
  const api = await signedIn('archive-during-detox@example.com')
  const work = idOf(await api.activities.list(), '仕事')
  await api.switches.switchTo({ activityId: work })
  await api.switches.switchTo({ activityId: null })

  // Act
  const archived = await api.activities.archive({ id: work })

  // Assert: the guard covers the current state's activity only; 仕事 goes while the detox state stays current
  expect(archived.archivedAt).toBeInstanceOf(Date)
  expect((await api.switches.current())?.activityId).toBeNull()
})

test('a switch without an activityId is refused as input: detox is an explicit null, never an omission', async () => {
  // Arrange
  const api = await signedIn('switch-missing-id@example.com')

  // Act + Assert
  await expect(
    // @ts-expect-error activityId is required even though it may be null
    api.switches.switchTo({}),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
})

const MIN = 60_000
const yesterday = addDays(today, -1)

test('merging into the previous record removes the row and the previous state now covers its time', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00.
  const api = await signedIn('merge@example.com')
  const list = await api.activities.list()
  const 仕事 = idOf(list, '仕事')
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: 仕事, startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  const before = await api.switches.listByDay({ day: yesterday })
  const rest = before.rows[1]
  if (!rest) throw new Error('fixture has no second row')

  // Act
  const merged = await api.switches.mergeIntoPrevious({ id: rest.id })

  // Assert: two rows remain, the previous one is marked as merged and 仕事 now runs 9:00–18:00.
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => row.startedAt)).toEqual([
    at(yesterday, 9),
    at(yesterday, 18),
  ])
  expect(merged).toMatchObject({ id: before.rows[0]?.id, source: 'merge' })
  const day = await api.stats.day({ day: yesterday })
  expect(day.totals[仕事]).toBe(9 * H)
})

test('merging into the next record removes the row and the next state now starts where it did', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00, 睡眠 23:00 (the current state).
  const api = await signedIn('merge-next@example.com')
  const list = await api.activities.list()
  const 娯楽 = idOf(list, '娯楽')
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: 娯楽, startedAt: at(yesterday, 18) },
      { activityId: idOf(list, '睡眠'), startedAt: at(yesterday, 23) },
    ],
  })
  const [, rest, fun] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!rest || !fun) throw new Error('fixture has fewer than three rows')

  // Act
  const merged = await api.switches.mergeIntoNext({ id: rest.id })

  // Assert: 休息 is gone, 娯楽 keeps its id and now runs 12:00–23:00.
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => row.startedAt)).toEqual([
    at(yesterday, 9),
    at(yesterday, 12),
    at(yesterday, 23),
  ])
  expect(merged).toMatchObject({
    id: fun.id,
    activityId: 娯楽,
    startedAt: at(yesterday, 12),
    source: 'merge',
  })
  const day = await api.stats.day({ day: yesterday })
  expect(day.totals[娯楽]).toBe(11 * H)
})

test('merging a mis-tap into the running state makes the clock start where the mis-tap did', async () => {
  // Arrange: yesterday 仕事 9:00, 娯楽 18:00 (the mis-tap), 睡眠 18:30, which is still running.
  const api = await signedIn('merge-next-running@example.com')
  const list = await api.activities.list()
  const 睡眠 = idOf(list, '睡眠')
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
      { activityId: 睡眠, startedAt: at(yesterday, 18.5) },
    ],
  })
  const [, misTap, running] = (await api.switches.listByDay({ day: yesterday }))
    .rows
  if (!misTap || !running) throw new Error('fixture has fewer than three rows')

  // Act
  await api.switches.mergeIntoNext({ id: misTap.id })

  // Assert: the running 睡眠 keeps its id and now runs from 18:00.
  expect(await api.switches.current()).toMatchObject({
    id: running.id,
    activityId: 睡眠,
    startedAt: at(yesterday, 18),
    source: 'merge',
  })
})

test('the current state cannot merge into the next record, since no state starts after it', async () => {
  // Arrange: 仕事 is the only row, so it is the current state.
  const api = await signedIn('merge-next-current@example.com')
  const work = await api.switches.switchTo({
    activityId: idOf(await api.activities.list(), '仕事'),
  })

  // Act
  const merge = api.switches.mergeIntoNext({ id: work.id })

  // Assert: refused, and the clock keeps its state.
  await expect(merge).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'no-neighbour' },
  })
  expect(await api.switches.current()).toMatchObject({ id: work.id })
})

test('another account cannot merge a switch into the next record: the id reads as missing and the owner’s rows stay as they were', async () => {
  // Arrange: the owner has yesterday 仕事 9:00 then 休息 12:00; the stranger has only its own seed.
  const owner = await signedIn('merge-next-owner@example.com')
  const stranger = await signedIn('merge-next-stranger@example.com')
  const list = await owner.activities.list()
  await owner.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
    ],
  })
  const [work, rest] = (await owner.switches.listByDay({ day: yesterday })).rows
  if (!work || !rest) throw new Error('fixture has fewer than two rows')

  // Act + Assert: 仕事 has a next state the owner could merge into, so only the ownership check can refuse the stranger.
  await expect(
    stranger.switches.mergeIntoNext({ id: work.id }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  const after = await owner.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => [row.id, row.startedAt, row.source])).toEqual([
    [work.id, at(yesterday, 9), 'correction'],
    [rest.id, at(yesterday, 12), 'correction'],
  ])
})

test('merging into a detox next record keeps it detox: the merged time moves out of the totals into detox', async () => {
  // Arrange: two days ago 仕事 9:00, detox 12:00, 休息 15:00 (9h, closed by yesterday's 00:00 睡眠).
  const api = await signedIn('merge-next-detox@example.com')
  const list = await api.activities.list()
  const 休息 = idOf(list, '休息')
  const day = addDays(today, -2)
  await api.switches.replaceDay({
    day,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(day, 9) },
      { activityId: null, startedAt: at(day, 12) },
      { activityId: 休息, startedAt: at(day, 15) },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '睡眠'), startedAt: at(yesterday, 0) }],
  })
  const [work, detox] = (await api.switches.listByDay({ day })).rows
  if (!work || !detox) throw new Error('fixture has fewer than two rows')

  // Act
  const merged = await api.switches.mergeIntoNext({ id: work.id })

  // Assert: the detox row keeps its id and no activity and now runs 9:00–15:00, so 仕事's 3h are detox time, in no total.
  expect(merged).toMatchObject({
    id: detox.id,
    activityId: null,
    startedAt: at(day, 9),
    source: 'merge',
  })
  const [after, stats] = await Promise.all([
    api.switches.listByDay({ day }),
    api.stats.day({ day }),
  ])
  expect(after.rows.map((row) => [row.activityId, row.startedAt])).toEqual([
    [null, at(day, 9)],
    [休息, at(day, 15)],
  ])
  expect(stats.totals).toEqual({ [休息]: 9 * H })
  expect(stats.days[0]).toMatchObject({ day, detoxMs: 6 * H })
})

test('the last record of a day cannot merge into the next day’s first switch, even one at exactly 0:00, so undoing the day cannot delete it', async () => {
  // Arrange: two days ago 仕事 9:00 and 娯楽 18:00; yesterday opens with 家事 at 0:00 sharp.
  const api = await signedIn('merge-next-cross-day@example.com')
  const list = await api.activities.list()
  const day = addDays(today, -2)
  await api.switches.replaceDay({
    day,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(day, 9) },
      { activityId: idOf(list, '娯楽'), startedAt: at(day, 18) },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '家事'), startedAt: at(yesterday, 0) }],
  })
  const [, fun] = (await api.switches.listByDay({ day })).rows
  if (!fun) throw new Error('fixture has fewer than two rows')

  // Act
  const merge = api.switches.mergeIntoNext({ id: fun.id })

  // Assert: refused, and neither day lost or moved a row.
  await expect(merge).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'next-on-later-day' },
  })
  const [thatDay, nextDay] = await Promise.all([
    api.switches.listByDay({ day }),
    api.switches.listByDay({ day: yesterday }),
  ])
  expect(thatDay.rows.map((row) => row.startedAt)).toEqual([
    at(day, 9),
    at(day, 18),
  ])
  expect(nextDay.rows.map((row) => row.startedAt)).toEqual([at(yesterday, 0)])
})

test('the day a merge may not leave is the account’s own: a record two hours before its midnight cannot merge into one half an hour after', async () => {
  // Arrange: Los Angeles; its midnight falls in the middle of a Tokyo day and of a UTC day, so both records share those days.
  const LA = 'America/Los_Angeles'
  const api = await signedIn('merge-next-zone@example.com')
  const list = await api.activities.list()
  await api.settings.update({ timeZone: LA })
  const zoneYesterday = addDays(localDay(new Date(), LA), -1)
  const zoneTwoDaysAgo = addDays(zoneYesterday, -1)
  await api.switches.replaceDay({
    day: zoneTwoDaysAgo,
    timeZone: LA,
    expected: [],
    rows: [
      {
        activityId: idOf(list, '仕事'),
        startedAt: new Date(dayBounds(zoneTwoDaysAgo, LA).end - 2 * H),
      },
    ],
  })
  await api.switches.replaceDay({
    day: zoneYesterday,
    timeZone: LA,
    expected: [],
    rows: [
      {
        activityId: idOf(list, '休息'),
        startedAt: new Date(dayBounds(zoneYesterday, LA).start + 0.5 * H),
      },
    ],
  })
  const [late] = (await api.switches.listByDay({ day: zoneTwoDaysAgo })).rows
  if (!late) throw new Error('fixture has no row')

  // Act
  const merge = api.switches.mergeIntoNext({ id: late.id })

  // Assert
  await expect(merge).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'next-on-later-day' },
  })
})

test('a merge of a record that another device has just merged away is refused, so the span stays with the record that merge gave it to', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00. Another device's 前の記録に統合 on 休息 has deleted it and marked
  // 仕事 as merged, but has not committed yet.
  const api = await signedIn('merge-race@example.com')
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
  const restDeletedUncommitted = Promise.withResolvers<void>()
  const otherMergeMayCommit = Promise.withResolvers<void>()
  const otherMerge = db.transaction(async (tx) => {
    await tx.delete(switches).where(eq(switches.id, rest.id))
    await tx
      .update(switches)
      .set({ source: 'merge' })
      .where(eq(switches.id, work.id))
    restDeletedUncommitted.resolve()
    await otherMergeMayCommit.promise
  })
  await restDeletedUncommitted.promise

  // Act: 次の記録に統合 on 休息 still reads the row, and its delete waits for the other merge; then that merge commits.
  const merge = api.switches.mergeIntoNext({ id: rest.id })
  const refused = expect(merge).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect
    .poll(
      async () => {
        const { rows } = await pool.query<{ waiting: number }>(
          `select count(*)::int as waiting from pg_stat_activity
           where datname = current_database() and wait_event_type = 'Lock' and query ilike 'delete from "switches"%'`,
        )
        return rows[0]?.waiting
      },
      { timeout: 3_000 },
    )
    .toBe(1)
  otherMergeMayCommit.resolve()
  await otherMerge

  // Assert: the second merge finds 休息 gone and is refused, so 仕事 keeps 9:00–18:00 and 娯楽 still starts at 18:00.
  await refused
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => [row.id, row.startedAt, row.source])).toEqual([
    [work.id, at(yesterday, 9), 'merge'],
    [fun.id, at(yesterday, 18), 'correction'],
  ])
})

test('splitting in half creates a second row at the midpoint with the same activity', async () => {
  // Arrange: yesterday 仕事 9:00 then 休息 13:00.
  const api = await signedIn('split@example.com')
  const list = await api.activities.list()
  const 仕事 = idOf(list, '仕事')
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: 仕事, startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 13) },
    ],
  })
  const before = await api.switches.listByDay({ day: yesterday })
  const work = before.rows[0]
  if (!work) throw new Error('fixture has no first row')

  // Act
  const created = await api.switches.splitInHalf({ id: work.id })

  // Assert
  expect(created).toMatchObject({
    activityId: 仕事,
    startedAt: at(yesterday, 11),
    source: 'split',
  })
  const after = await api.switches.listByDay({ day: yesterday })
  expect(
    after.rows.map((row) => [row.activityId === 仕事, row.startedAt]),
  ).toEqual([
    [true, at(yesterday, 9)],
    [true, at(yesterday, 11)],
    [false, at(yesterday, 13)],
  ])
})

test('moving a start time cannot cross the neighbouring rows', async () => {
  // Arrange: three rows five minutes apart, so ±15 min always meets a neighbour.
  const api = await signedIn('move@example.com')
  const list = await api.activities.list()
  const nine = at(yesterday, 9).getTime()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: new Date(nine) },
      { activityId: idOf(list, '休息'), startedAt: new Date(nine + 5 * MIN) },
      { activityId: idOf(list, '娯楽'), startedAt: new Date(nine + 10 * MIN) },
    ],
  })
  const { rows } = await api.switches.listByDay({ day: yesterday })
  const rest = rows[1]
  if (!rest) throw new Error('fixture has no second row')

  // Act
  const earlier = await api.switches.moveStart({
    id: rest.id,
    deltaMinutes: -15,
  })
  const later = await api.switches.moveStart({ id: rest.id, deltaMinutes: 15 })

  // Assert: clamped to one minute after 仕事, then one minute before 娯楽; a row with no room at all is refused.
  expect(earlier.startedAt).toEqual(new Date(nine + MIN))
  expect(later.startedAt).toEqual(new Date(nine + 9 * MIN))
  expect(earlier.source).toBe('correction')
  const moved = await api.switches.listByDay({ day: yesterday })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: listedRows(moved.rows),
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: new Date(nine) },
      { activityId: idOf(list, '休息'), startedAt: new Date(nine + MIN) },
      {
        activityId: idOf(list, '娯楽'),
        startedAt: new Date(nine + MIN + 30_000),
      },
    ],
  })
  const cramped = (await api.switches.listByDay({ day: yesterday })).rows[1]
  if (!cramped) throw new Error('fixture has no second row')
  await expect(
    api.switches.moveStart({ id: cramped.id, deltaMinutes: 15 }),
  ).rejects.toMatchObject({ code: 'CONFLICT', data: { reason: 'no-room' } })
})

test('reorder rejects a position set that is not a permutation', async () => {
  // Arrange
  const api = await signedIn('reorder@example.com')
  const ids = (await api.activities.list()).map((row) => row.id)

  // Act + Assert
  await expect(
    api.activities.reorder({ ids: ids.slice(1) }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  await expect(
    api.activities.reorder({ ids: [...ids.slice(0, 5), ...ids.slice(0, 1)] }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  const reordered = await api.activities.reorder({ ids: [...ids].reverse() })
  expect(reordered.map((row) => row.name)).toEqual([
    '娯楽',
    '食事',
    '睡眠',
    '休息',
    '仕事',
    '家事',
  ])
})

test('a color outside the palette is rejected', async () => {
  // Arrange
  const api = await signedIn('palette@example.com')
  const { id: userId } = await api.me()

  // Act + Assert: the schema first, then the CHECK constraint behind it
  await expect(
    api.activities.create({
      name: '読書',
      // @ts-expect-error -- not one of the 8 palette hexes
      color: '#000000',
      iconKey: 'book',
      targetHours: 1,
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  await expect(
    db.insert(activities).values({
      userId,
      name: '読書',
      color: '#000000',
      iconKey: 'book',
      position: 9,
    }),
  ).rejects.toMatchObject({ cause: { constraint: 'activities_color_palette' } })
})

test('archiving an activity flags it without dropping its day rows or totals', async () => {
  // Arrange: two days ago 休息 9:00 and 仕事 15:00, 睡眠 since yesterday 0:00 (the current state), so 休息 can be archived.
  const api = await signedIn('archive@example.com')
  const list = await api.activities.list()
  const rest = idOf(list, '休息')
  const work = idOf(list, '仕事')
  const day = addDays(today, -2)
  await api.switches.replaceDay({
    day,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: rest, startedAt: at(day, 9) },
      { activityId: work, startedAt: at(day, 15) },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '睡眠'), startedAt: at(yesterday, 0) }],
  })

  // Act
  const archived = await api.activities.archive({ id: rest })

  // Assert: the row is flagged and leaves the active set (what Home filters on); the day's rows and totals still carry it.
  const [after, listed, stats] = await Promise.all([
    api.activities.list(),
    api.switches.listByDay({ day }),
    api.stats.day({ day }),
  ])
  expect(archived.archivedAt).toBeInstanceOf(Date)
  expect(
    after.filter((row) => row.archivedAt === null).map((row) => row.name),
  ).toEqual(['家事', '仕事', '睡眠', '食事', '娯楽'])
  expect(listed.rows.map((row) => row.activityId)).toEqual([rest, work])
  expect(stats.totals).toEqual({ [rest]: 21_600_000, [work]: 32_400_000 })
})

test('a corrected segment cannot be moved onto an archived activity', async () => {
  // Arrange
  const api = await signedIn('change-archived@example.com')
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const rest = idOf(list, '休息')
  const row = await api.switches.switchTo({ activityId: work })
  await api.activities.archive({ id: rest })

  // Act + Assert: the reason tells the sheet's undo this refusal apart from any other BAD_REQUEST
  await expect(
    api.switches.changeActivity({ id: row.id, activityId: rest }),
  ).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    data: { reason: 'archived' },
  })
})

test('splitting keeps both halves at least a minute long', async () => {
  // Arrange
  const api = await signedIn('split@example.com')
  const { id: userId } = await api.me()
  const work = idOf(await api.activities.list(), '仕事')
  const yesterday = addDays(today, -1)
  const [long, , short] = await db
    .insert(switches)
    .values([
      { userId, activityId: work, startedAt: at(yesterday, 10) },
      { userId, activityId: work, startedAt: at(yesterday, 12) },
      { userId, activityId: work, startedAt: at(yesterday, 14) },
      {
        userId,
        activityId: work,
        startedAt: new Date(at(yesterday, 14).getTime() + 90_000),
      },
    ])
    .returning()
  if (!long || !short) throw new Error('seed failed')

  // Act
  const half = await api.switches.splitInHalf({ id: long.id })

  // Assert
  expect(half.startedAt).toEqual(at(yesterday, 11))
  expect(half.source).toBe('split')
  await expect(
    api.switches.splitInHalf({ id: short.id }),
  ).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'cannot-split' },
  })
})

test('an empty settings update is rejected as input, not as a database error', async () => {
  // Arrange
  const api = await signedIn('empty-settings@example.com')

  // Act + Assert
  await expect(api.settings.update({})).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  })
})

test('a replaced day that would end on an archived activity with nothing after it is refused, so an archived activity never runs', async () => {
  // Arrange: no switches yet, so nothing keeps 休息 from being archived
  const api = await signedIn('replace-archived@example.com')
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const rest = idOf(list, '休息')
  await api.activities.archive({ id: rest })
  const yesterday = addDays(today, -1)

  // Act
  const replacement = api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: work, startedAt: at(yesterday, 9) },
      { activityId: rest, startedAt: at(yesterday, 12) },
    ],
  })

  // Assert: nothing was recorded after 12:00, so 休息 would have become the current state; nothing was written
  await expect(replacement).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    data: { reason: 'archived' },
  })
  expect(await api.switches.current()).toBeNull()
})

test('a replaced day may end on an archived activity when a later switch follows, since that record is past time', async () => {
  // Arrange: 家事 runs from today 0:00, so yesterday's last row is not the current state
  const api = await signedIn('replace-archived-past@example.com')
  const { id: userId } = await api.me()
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const rest = idOf(list, '休息')
  const home = idOf(list, '家事')
  await db
    .insert(switches)
    .values({ userId, activityId: home, startedAt: at(today, 0) })
  await api.activities.archive({ id: rest })
  const yesterday = addDays(today, -1)

  // Act
  const written = await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: work, startedAt: at(yesterday, 9) },
      { activityId: rest, startedAt: at(yesterday, 12) },
    ],
  })

  // Assert
  expect(written.map((row) => [row.activityId, row.startedAt])).toEqual([
    [work, at(yesterday, 9)],
    [rest, at(yesterday, 12)],
  ])
  expect(await api.switches.current()).toMatchObject({ activityId: home })
})

test('tapping an archived activity that is still the current state is refused, and that state keeps running', async () => {
  // Arrange: an archived 休息 as the current state, which only data from before the latest-row check can hold
  const api = await signedIn('retap-archived@example.com')
  const { id: userId } = await api.me()
  const rest = idOf(await api.activities.list(), '休息')
  await api.activities.archive({ id: rest })
  const yesterday = addDays(today, -1)
  await db
    .insert(switches)
    .values({ userId, activityId: rest, startedAt: at(yesterday, 12) })

  // Act: the archived check runs before the same-state shortcut, so the re-tap is refused, not answered
  const retap = api.switches.switchTo({ activityId: rest })

  // Assert: refused, and the archived 休息 keeps running from 12:00
  await expect(retap).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  expect(await api.switches.current()).toMatchObject({
    activityId: rest,
    startedAt: at(yesterday, 12),
  })
})

test('元に戻す restores a day whose rows include an archived activity', async () => {
  // Arrange: yesterday 仕事 9:00 and 休息 12:00; 家事 is the current state, so 休息 can be archived; then 仕事 moves to 9:15
  const api = await signedIn('undo-archived@example.com')
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const rest = idOf(list, '休息')
  const yesterday = addDays(today, -1)
  const snapshot = [
    { activityId: work, startedAt: at(yesterday, 9) },
    { activityId: rest, startedAt: at(yesterday, 12) },
  ]
  const [first] = await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: snapshot,
  })
  if (!first) throw new Error('seed failed')
  await api.switches.switchTo({ activityId: idOf(list, '家事') })
  await api.activities.archive({ id: rest })
  await api.switches.moveStart({ id: first.id, deltaMinutes: 15 })
  // The edit moved 仕事 only, so the archived 休息 rides along in the snapshot as a bystander
  const edited = await api.switches.listByDay({ day: yesterday })
  expect(edited.rows.map((row) => [row.activityId, row.startedAt])).toEqual([
    [work, at(yesterday, 9.25)],
    [rest, at(yesterday, 12)],
  ])

  // Act
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: listedRows(edited.rows),
    rows: snapshot,
  })

  // Assert
  const { rows } = await api.switches.listByDay({ day: yesterday })
  expect(rows.map((row) => [row.activityId, row.startedAt])).toEqual([
    [work, at(yesterday, 9)],
    [rest, at(yesterday, 12)],
  ])
})

test('a replaced day cannot be written onto another account’s activity: it reads as missing', async () => {
  // Arrange: the stranger sends the owner's 仕事 id
  const owner = await signedIn('replace-owner@example.com')
  const stranger = await signedIn('replace-stranger@example.com')
  const work = idOf(await owner.activities.list(), '仕事')
  const yesterday = addDays(today, -1)

  // Act
  const replacement = stranger.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: work, startedAt: at(yesterday, 9) }],
  })

  // Assert: refused, and nothing reached the stranger's day
  await expect(replacement).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect((await stranger.switches.listByDay({ day: yesterday })).rows).toEqual(
    [],
  )
})

test('元に戻す writes back a day where one activity holds several rows', async () => {
  // Arrange: 仕事 before and after 休息, the everyday shape of a day; the ownership check must count 仕事 once
  const api = await signedIn('replace-repeated@example.com')
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const rest = idOf(list, '休息')
  const yesterday = addDays(today, -1)

  // Act
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: work, startedAt: at(yesterday, 9) },
      { activityId: rest, startedAt: at(yesterday, 12) },
      { activityId: work, startedAt: at(yesterday, 13) },
    ],
  })

  // Assert
  const { rows } = await api.switches.listByDay({ day: yesterday })
  expect(rows.map((row) => [row.activityId, row.startedAt])).toEqual([
    [work, at(yesterday, 9)],
    [rest, at(yesterday, 12)],
    [work, at(yesterday, 13)],
  ])
})

test('a replaced day that slips in another account’s activity beside the user’s own is refused, and the day stays as it was', async () => {
  // Arrange: the stranger's yesterday holds 仕事 9:00; the replacement pairs the stranger's 休息 with the owner's 仕事
  const owner = await signedIn('replace-mixed-owner@example.com')
  const stranger = await signedIn('replace-mixed-stranger@example.com')
  const ownersWork = idOf(await owner.activities.list(), '仕事')
  const strangersList = await stranger.activities.list()
  const strangersWork = idOf(strangersList, '仕事')
  const strangersRest = idOf(strangersList, '休息')
  const yesterday = addDays(today, -1)
  await stranger.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: strangersWork, startedAt: at(yesterday, 9) }],
  })

  // Act
  const replacement = stranger.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: strangersRest, startedAt: at(yesterday, 10) },
      { activityId: ownersWork, startedAt: at(yesterday, 12) },
    ],
  })

  // Assert: refused, and the stranger's day still holds only its 仕事 9:00
  await expect(replacement).rejects.toMatchObject({ code: 'NOT_FOUND' })
  const { rows } = await stranger.switches.listByDay({ day: yesterday })
  expect(rows.map((row) => [row.activityId, row.startedAt])).toEqual([
    [strangersWork, at(yesterday, 9)],
  ])
})

test('splitting a record of an archived activity keeps both halves on that activity', async () => {
  // Arrange: yesterday 休息 10:00 then 仕事 12:00; 家事 is the current state, so 休息 can be archived
  const api = await signedIn('split-archived@example.com')
  const list = await api.activities.list()
  const rest = idOf(list, '休息')
  const work = idOf(list, '仕事')
  const yesterday = addDays(today, -1)
  const [restRow] = await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: rest, startedAt: at(yesterday, 10) },
      { activityId: work, startedAt: at(yesterday, 12) },
    ],
  })
  if (!restRow) throw new Error('seed failed')
  await api.switches.switchTo({ activityId: idOf(list, '家事') })
  await api.activities.archive({ id: rest })

  // Act
  const half = await api.switches.splitInHalf({ id: restRow.id })

  // Assert: the new row at 11:00 stays 休息; only the writes that pick an activity refuse an archived one
  expect(half).toMatchObject({
    activityId: rest,
    startedAt: at(yesterday, 11),
    source: 'split',
  })
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => [row.activityId, row.startedAt])).toEqual([
    [rest, at(yesterday, 10)],
    [rest, at(yesterday, 11)],
    [work, at(yesterday, 12)],
  ])
})

test('merging the current state into the record of an archived activity is refused, and the current state keeps running', async () => {
  // Arrange: yesterday 休息 10:00 then 仕事 12:00; 仕事 is the current state, so 休息 can be archived
  const api = await signedIn('merge-onto-archived@example.com')
  const list = await api.activities.list()
  const rest = idOf(list, '休息')
  const work = idOf(list, '仕事')
  const yesterday = addDays(today, -1)
  const [, workRow] = await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: rest, startedAt: at(yesterday, 10) },
      { activityId: work, startedAt: at(yesterday, 12) },
    ],
  })
  if (!workRow) throw new Error('seed failed')
  await api.activities.archive({ id: rest })

  // Act
  const merge = api.switches.mergeIntoPrevious({ id: workRow.id })

  // Assert: the merge would have made the archived 休息 run on from 10:00
  await expect(merge).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    data: { reason: 'archived' },
  })
  expect(await api.switches.current()).toMatchObject({
    id: workRow.id,
    activityId: work,
    startedAt: at(yesterday, 12),
  })
})

test('merging a past record into the record of an archived activity still lands, since the current state stays as it was', async () => {
  // Arrange: yesterday 休息 10:00, 仕事 12:00, 家事 15:00; 家事 runs, so 休息 can be archived
  const api = await signedIn('merge-past-onto-archived@example.com')
  const list = await api.activities.list()
  const rest = idOf(list, '休息')
  const work = idOf(list, '仕事')
  const home = idOf(list, '家事')
  const yesterday = addDays(today, -1)
  const [restRow, workRow] = await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: rest, startedAt: at(yesterday, 10) },
      { activityId: work, startedAt: at(yesterday, 12) },
      { activityId: home, startedAt: at(yesterday, 15) },
    ],
  })
  if (!restRow || !workRow) throw new Error('seed failed')
  await api.activities.archive({ id: rest })

  // Act
  const kept = await api.switches.mergeIntoPrevious({ id: workRow.id })

  // Assert
  expect(kept).toMatchObject({ id: restRow.id, activityId: rest })
  expect(await api.switches.current()).toMatchObject({ activityId: home })
})

test('a replaced day rejects two segments that start at the same moment', async () => {
  // Arrange: equal timestamps would leave the day's order (and its totals) to Postgres
  const api = await signedIn('replace-duplicate@example.com')
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const rest = idOf(list, '休息')
  const yesterday = addDays(today, -1)

  // Act + Assert
  await expect(
    api.switches.replaceDay({
      day: yesterday,
      timeZone: TZ,
      expected: [],
      rows: [
        { activityId: work, startedAt: at(yesterday, 9) },
        { activityId: rest, startedAt: at(yesterday, 9) },
      ],
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
})

test('an account whose settings row is missing can still change a setting', async () => {
  // Arrange: only the settings row is gone, so the repair must leave the activities exactly as they were
  const api = await signedIn('unseeded-update@example.com')
  const { id: userId } = await api.me()
  const before = await api.activities.list()
  await db.delete(userSettings).where(eq(userSettings.userId, userId))

  // Act
  const settings = await api.settings.update({ showSecondHand: false })

  // Assert
  expect(settings.showSecondHand).toBe(false)
  expect(await api.activities.list()).toEqual(before)
})

test('stats work in a zone Postgres only knows under another name', async () => {
  // Arrange: ICU canonicalises Asia/Kolkata to Asia/Calcutta, which Postgres without tzdata-legacy rejects
  const api = await signedIn('calcutta@example.com')
  const { id: userId } = await api.me()
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const rest = idOf(list, '休息')
  await api.settings.update({ timeZone: 'Asia/Calcutta' })
  const yesterday = addDays(localDay(new Date(), 'Asia/Calcutta'), -1)
  const { start } = dayBounds(yesterday, 'Asia/Calcutta')
  await db.insert(switches).values([
    { userId, activityId: work, startedAt: new Date(start + 9 * H) },
    { userId, activityId: rest, startedAt: new Date(start + 10 * H) },
  ])

  // Act
  const day = await api.stats.day({ day: yesterday })

  // Assert: 仕事 ran 9:00–10:00 Calcutta time; before the fix the query itself raised "time zone not recognized"
  expect(day.totals[work]).toBe(3_600_000)
})

test('an account whose seed rows are missing gets them on the first settings read', async () => {
  // Arrange: what a failed user.create.after hook (or an account older than the domain tables) leaves behind
  const api = await signedIn('unseeded@example.com')
  const { id: userId } = await api.me()
  await db.delete(activities).where(eq(activities.userId, userId))
  await db.delete(userSettings).where(eq(userSettings.userId, userId))

  // Act: the activity list repairs the account on its own, without a settings read first
  const names = (await api.activities.list()).map((row) => row.name)
  const settings = await api.settings.get()

  // Assert
  expect(settings).toMatchObject({ timeZone: 'Asia/Tokyo', theme: 'auto' })
  expect(names).toEqual(['家事', '仕事', '休息', '睡眠', '食事', '娯楽'])
})

test('splitting a detox span keeps both halves detox', async () => {
  // Arrange: yesterday 仕事 9:00, detox 12:00, 休息 18:00; the detox row is the one in the middle
  const api = await signedIn('split-detox@example.com')
  const list = await api.activities.list()
  const yesterday = addDays(today, -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: null, startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 18) },
    ],
  })
  const detox = (await api.switches.listByDay({ day: yesterday })).rows[1]
  if (!detox) throw new Error('fixture has no second row')

  // Act
  const half = await api.switches.splitInHalf({ id: detox.id })

  // Assert: the new row at 15:00 is detox too, so the time stays recorded to nothing on both sides of the cut
  expect(half).toMatchObject({
    activityId: null,
    startedAt: at(yesterday, 15),
    source: 'split',
  })
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => row.activityId)).toEqual([
    idOf(list, '仕事'),
    null,
    null,
    idOf(list, '休息'),
  ])
})

test('the very first tap can be detox: the clock starts on a state with no activity', async () => {
  // Arrange: a fresh account, nothing tapped yet
  const api = await signedIn('first-detox@example.com')
  expect(await api.switches.current()).toBeNull()

  // Act
  const first = await api.switches.switchTo({ activityId: null })

  // Assert: with no current row to compare against, a detox row is inserted and becomes the current state
  expect(first).toMatchObject({ activityId: null, source: 'tap' })
  expect((await api.switches.current())?.id).toBe(first.id)
})

test('another account cannot move a switch onto detox or switch to a foreign activity: both read as missing', async () => {
  // Arrange: the owner has a switch on 仕事; the stranger has only its own seed
  const owner = await signedIn('owner@example.com')
  const stranger = await signedIn('stranger@example.com')
  const work = idOf(await owner.activities.list(), '仕事')
  const row = await owner.switches.switchTo({ activityId: work })

  // Act + Assert: with activityId null the activity lookup is skipped, so the switch lookup alone must refuse the stranger
  await expect(
    stranger.switches.changeActivity({ id: row.id, activityId: null }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(
    stranger.switches.switchTo({ activityId: work }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect((await owner.switches.current())?.activityId).toBe(work)
})

const twoDaysAgo = addDays(today, -2)

test('cutting the record carried into a day inserts a row at the chosen time with the record’s activity', async () => {
  // Arrange: 仕事 from 22:00 two days ago runs into yesterday until 食事 at 7:00
  const api = await signedIn('split-at@example.com')
  const list = await api.activities.list()
  const 仕事 = idOf(list, '仕事')
  await api.switches.replaceDay({
    day: twoDaysAgo,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: 仕事, startedAt: at(twoDaysAgo, 22) }],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '食事'), startedAt: at(yesterday, 7) }],
  })
  const { carriedIn } = await api.switches.listByDay({ day: yesterday })
  if (!carriedIn) throw new Error('fixture carries nothing into yesterday')

  // Act
  const created = await api.switches.splitAt({
    id: carriedIn.id,
    at: at(yesterday, 3),
  })

  // Assert: yesterday now opens with its own 仕事 row at 3:00, and the carried-in record still starts two days ago
  expect(created).toMatchObject({
    activityId: 仕事,
    startedAt: at(yesterday, 3),
    source: 'split',
  })
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.carriedIn).toMatchObject({
    id: carriedIn.id,
    startedAt: at(twoDaysAgo, 22),
  })
  expect(after.rows.map((row) => [row.id, row.startedAt])).toEqual([
    [created.id, at(yesterday, 3)],
    [after.rows[1]?.id, at(yesterday, 7)],
  ])
})

test('a cut keeps a minute from both ends of the record: exactly a minute is accepted, a millisecond less is refused', async () => {
  // Arrange: yesterday 仕事 9:00 then 休息 13:00
  const api = await signedIn('split-at-margins@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 13) },
    ],
  })
  const work = (await api.switches.listByDay({ day: yesterday })).rows[0]
  if (!work) throw new Error('fixture has no first row')
  const earliest = at(yesterday, 9).getTime() + MIN
  const latest = at(yesterday, 13).getTime() - MIN

  // Act + Assert: a millisecond inside either margin is refused and writes nothing
  await expect(
    api.switches.splitAt({ id: work.id, at: new Date(earliest - 1) }),
  ).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'cannot-split' },
  })
  await expect(
    api.switches.splitAt({ id: work.id, at: new Date(latest + 1) }),
  ).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'cannot-split' },
  })
  expect((await api.switches.listByDay({ day: yesterday })).rows).toHaveLength(
    2,
  )

  // Act + Assert: exactly a minute from the next record, then exactly a minute from the record's own start
  await api.switches.splitAt({ id: work.id, at: new Date(latest) })
  await api.switches.splitAt({ id: work.id, at: new Date(earliest) })
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => row.startedAt)).toEqual([
    at(yesterday, 9),
    new Date(earliest),
    new Date(latest),
    at(yesterday, 13),
  ])
})

test('the current state cannot be cut within the last minute before now', async () => {
  // Arrange: 仕事 has been the current state for two hours
  const api = await signedIn('split-at-now@example.com')
  const { id: userId } = await api.me()
  const 仕事 = idOf(await api.activities.list(), '仕事')
  const [current] = await db
    .insert(switches)
    .values({
      userId,
      activityId: 仕事,
      startedAt: new Date(Date.now() - 2 * H),
    })
    .returning()
  if (!current) throw new Error('seed failed')

  // Act + Assert: half a minute ago is too close to now; an hour ago is fine
  await expect(
    api.switches.splitAt({
      id: current.id,
      at: new Date(Date.now() - 30_000),
    }),
  ).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'cannot-split' },
  })
  const anHourAgo = new Date(Date.now() - H)
  const created = await api.switches.splitAt({ id: current.id, at: anHourAgo })
  expect(created).toMatchObject({ activityId: 仕事, startedAt: anHourAgo })
  expect((await api.switches.current())?.id).toBe(created.id)
})

test('another account cannot cut a record: the id reads as missing and the owner’s rows stay as they were', async () => {
  // Arrange: the owner has yesterday 仕事 9:00 then 休息 13:00
  const owner = await signedIn('split-at-owner@example.com')
  const stranger = await signedIn('split-at-stranger@example.com')
  const list = await owner.activities.list()
  await owner.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 13) },
    ],
  })
  const work = (await owner.switches.listByDay({ day: yesterday })).rows[0]
  if (!work) throw new Error('fixture has no first row')

  // Act + Assert: 11:00 is a valid cut for the owner, so only the ownership check can refuse the stranger
  await expect(
    stranger.switches.splitAt({ id: work.id, at: at(yesterday, 11) }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  const after = await owner.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => row.startedAt)).toEqual([
    at(yesterday, 9),
    at(yesterday, 13),
  ])
})

test('an activity change that names the revision it saw writes once, and a second change at that revision is refused', async () => {
  // Arrange: a 仕事 record at revision 0
  const api = await signedIn('change-revision@example.com')
  const list = await api.activities.list()
  const 睡眠 = idOf(list, '睡眠')
  const row = await api.switches.switchTo({ activityId: idOf(list, '仕事') })

  // Act: 仕事 → 睡眠 at revision 0, then a second change that still names revision 0
  const changed = await api.switches.changeActivity({
    id: row.id,
    activityId: 睡眠,
    revision: 0,
  })
  const stale = api.switches.changeActivity({
    id: row.id,
    activityId: idOf(list, '休息'),
    revision: 0,
  })

  // Assert: the first writes and moves the revision on, the stale one is refused and leaves 睡眠 in place
  expect(changed).toMatchObject({
    id: row.id,
    activityId: 睡眠,
    source: 'correction',
    revision: 1,
  })
  await expect(stale).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'record-changed' },
  })
  expect((await api.switches.current())?.activityId).toBe(睡眠)
})

test('an activity change that names a revision reads as missing once the record is gone', async () => {
  // Arrange: yesterday 仕事 9:00 then 休息 13:00, and 休息 merged away into 仕事
  const api = await signedIn('change-revision-gone@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 13) },
    ],
  })
  const rest = (await api.switches.listByDay({ day: yesterday })).rows[1]
  if (!rest) throw new Error('fixture has no second row')
  await api.switches.mergeIntoPrevious({ id: rest.id })

  // Act
  const change = api.switches.changeActivity({
    id: rest.id,
    activityId: idOf(list, '睡眠'),
    revision: rest.revision,
  })

  // Assert
  await expect(change).rejects.toMatchObject({ code: 'NOT_FOUND' })
})

test('a stale activity undo is refused after another device merged the next record into it, so the merged time keeps its activity', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 13:00, 食事 15:00; device A changes 仕事 to 睡眠, arming an undo at the new revision
  const api = await signedIn('undo-after-merge@example.com')
  const list = await api.activities.list()
  const 仕事 = idOf(list, '仕事')
  const 睡眠 = idOf(list, '睡眠')
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: 仕事, startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 13) },
      { activityId: idOf(list, '食事'), startedAt: at(yesterday, 15) },
    ],
  })
  const [work, rest] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!work || !rest) throw new Error('fixture has no rows')
  const picked = await api.switches.changeActivity({
    id: work.id,
    activityId: 睡眠,
    revision: work.revision,
  })
  // Device B merges 休息 into the record, which now runs 9:00 – 15:00 with the same id and activity
  await api.switches.mergeIntoPrevious({ id: rest.id })

  // Act: device A's undo, at the revision its pick left
  const undo = api.switches.changeActivity({
    id: work.id,
    activityId: 仕事,
    revision: picked.revision,
  })

  // Assert: refused, and 9:00 – 15:00 stays 睡眠
  await expect(undo).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'record-changed' },
  })
  const after = await api.switches.listByDay({ day: yesterday })
  expect(after.rows.map((row) => [row.startedAt, row.activityId])).toEqual([
    [at(yesterday, 9), 睡眠],
    [at(yesterday, 15), idOf(list, '食事')],
  ])
})

test('a stale activity undo is refused after another device changed the activity away and back again', async () => {
  // Arrange: device A changes a 仕事 record to 睡眠; device B changes it to 娯楽 and back to 睡眠
  const api = await signedIn('undo-after-aba@example.com')
  const list = await api.activities.list()
  const 仕事 = idOf(list, '仕事')
  const 睡眠 = idOf(list, '睡眠')
  const row = await api.switches.switchTo({ activityId: 仕事 })
  const picked = await api.switches.changeActivity({
    id: row.id,
    activityId: 睡眠,
    revision: row.revision,
  })
  const away = await api.switches.changeActivity({
    id: row.id,
    activityId: idOf(list, '娯楽'),
    revision: picked.revision,
  })
  await api.switches.changeActivity({
    id: row.id,
    activityId: 睡眠,
    revision: away.revision,
  })

  // Act: device A's undo still names the revision its pick left, though the activity reads 睡眠 again
  const undo = api.switches.changeActivity({
    id: row.id,
    activityId: 仕事,
    revision: picked.revision,
  })

  // Assert
  await expect(undo).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'record-changed' },
  })
  expect((await api.switches.current())?.activityId).toBe(睡眠)
})

test('a stale carried-in undo is refused after the record was picked again on its own day’s sheet, which names no revision', async () => {
  // Arrange: device A changes a 仕事 record to 睡眠 as carried-in; device B, on the record's own day, picks 娯楽 then 睡眠 without a revision
  const api = await signedIn('undo-after-own-day-picks@example.com')
  const list = await api.activities.list()
  const 睡眠 = idOf(list, '睡眠')
  const row = await api.switches.switchTo({ activityId: idOf(list, '仕事') })
  const picked = await api.switches.changeActivity({
    id: row.id,
    activityId: 睡眠,
    revision: row.revision,
  })
  await api.switches.changeActivity({
    id: row.id,
    activityId: idOf(list, '娯楽'),
  })
  await api.switches.changeActivity({ id: row.id, activityId: 睡眠 })

  // Act
  const undo = api.switches.changeActivity({
    id: row.id,
    activityId: idOf(list, '仕事'),
    revision: picked.revision,
  })

  // Assert
  await expect(undo).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'record-changed' },
  })
  expect(await api.switches.current()).toMatchObject({
    activityId: 睡眠,
    revision: 3,
  })
})

test('an activity change naming a negative or fractional revision is refused as bad input and writes nothing', async () => {
  // Arrange
  const api = await signedIn('change-bad-revision@example.com')
  const list = await api.activities.list()
  const 仕事 = idOf(list, '仕事')
  const row = await api.switches.switchTo({ activityId: 仕事 })

  // Act
  const negative = await api.switches
    .changeActivity({
      id: row.id,
      activityId: idOf(list, '睡眠'),
      revision: -1,
    })
    .catch((error: unknown) => error)
  const fractional = await api.switches
    .changeActivity({
      id: row.id,
      activityId: idOf(list, '睡眠'),
      revision: 0.5,
    })
    .catch((error: unknown) => error)

  // Assert
  expect([negative, fractional]).toMatchObject([
    { code: 'BAD_REQUEST' },
    { code: 'BAD_REQUEST' },
  ])
  expect(await api.switches.current()).toMatchObject({
    activityId: 仕事,
    revision: 0,
  })
})

test('every write that moves where a record ends moves that record’s revision on', async () => {
  // Arrange: yesterday 仕事 9:00 then 休息 13:00
  const api = await signedIn('revision-bumps@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 13) },
    ],
  })
  const [work] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!work) throw new Error('fixture has no first row')
  const revisionOf = async (id: string) =>
    (await api.switches.listByDay({ day: yesterday })).rows.find(
      (row) => row.id === id,
    )?.revision

  // Act + Assert: each write that moves 仕事's end moves its revision on by one
  const half = await api.switches.splitInHalf({ id: work.id })
  expect(await revisionOf(work.id)).toBe(1)
  await api.switches.moveStart({ id: half.id, deltaMinutes: 15 })
  expect([await revisionOf(work.id), await revisionOf(half.id)]).toEqual([2, 1])
  await api.switches.mergeIntoPrevious({ id: half.id })
  expect(await revisionOf(work.id)).toBe(3)
  await api.switches.splitAt({ id: work.id, at: at(yesterday, 10) })
  expect(await revisionOf(work.id)).toBe(4)
})

test('a tap ends the running record and a rewritten day moves the record carried into it, and both move its revision on', async () => {
  // Arrange: yesterday 睡眠 from 22:00 runs into today
  const api = await signedIn('revision-tap-replace@example.com')
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: TZ,
    expected: [],
    rows: [{ activityId: idOf(list, '睡眠'), startedAt: at(yesterday, 22) }],
  })
  const sleep = await api.switches.current()
  if (!sleep) throw new Error('fixture has no current state')

  // Act: a tap ends 睡眠, then today's rows are rewritten, which moves where 睡眠 ends
  await api.switches.switchTo({ activityId: idOf(list, '仕事') })
  const afterTap = (await api.switches.listByDay({ day: yesterday })).rows[0]
  const tapped = await api.switches.listByDay({ day: today })
  await api.switches.replaceDay({
    day: today,
    timeZone: TZ,
    expected: listedRows(tapped.rows),
    rows: [{ activityId: idOf(list, '家事'), startedAt: at(today, 0) }],
  })
  const afterReplace = (await api.switches.listByDay({ day: yesterday }))
    .rows[0]

  // Assert
  expect([sleep.revision, afterTap?.revision, afterReplace?.revision]).toEqual([
    0, 1, 2,
  ])
})

import { addDays, dayBounds, localDay } from '@switch-time/shared'
import { expect, test } from 'vitest'

import { db } from '../db/client'
import { activities } from '../db/schema/app'
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
  ).rejects.toMatchObject({ code: 'CONFLICT' })
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
    rows: [{ activityId: work, startedAt: at(twoDaysAgo, 9) }],
  })
  await api.switches.replaceDay({
    day: today,
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
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(threeDaysAgo, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(threeDaysAgo, 18) },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 8) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  await api.switches.replaceDay({
    day: today,
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
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(day, 0) },
      { activityId: idOf(list, '休息'), startedAt: at(day, 13) },
      { activityId: idOf(list, '食事'), startedAt: at(day, 15) },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
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

const MIN = 60_000
const yesterday = addDays(today, -1)

test('merging into the previous record removes the row and the previous state now covers its time', async () => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00.
  const api = await signedIn('merge@example.com')
  const list = await api.activities.list()
  const 仕事 = idOf(list, '仕事')
  await api.switches.replaceDay({
    day: yesterday,
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

test('splitting in half creates a second row at the midpoint with the same activity', async () => {
  // Arrange: yesterday 仕事 9:00 then 休息 13:00.
  const api = await signedIn('split@example.com')
  const list = await api.activities.list()
  const 仕事 = idOf(list, '仕事')
  await api.switches.replaceDay({
    day: yesterday,
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
  await api.switches.replaceDay({
    day: yesterday,
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
  ).rejects.toThrow('no room to move')
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

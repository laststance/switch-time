import { addDays, dayBounds, localDay } from '@switch-time/shared'
import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'

import { db } from '../db/client'
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

test('a corrected segment cannot be moved onto an archived activity', async () => {
  // Arrange
  const api = await signedIn('change-archived@example.com')
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const rest = idOf(list, '休息')
  const row = await api.switches.switchTo({ activityId: work })
  await api.activities.archive({ id: rest })

  // Act + Assert
  await expect(
    api.switches.changeActivity({ id: row.id, activityId: rest }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
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
  ).rejects.toMatchObject({ code: 'CONFLICT' })
})

test('an empty settings update is rejected as input, not as a database error', async () => {
  // Arrange
  const api = await signedIn('empty-settings@example.com')

  // Act + Assert
  await expect(api.settings.update({})).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  })
})

test('a replaced day cannot be written onto an archived activity', async () => {
  // Arrange
  const api = await signedIn('replace-archived@example.com')
  const list = await api.activities.list()
  const work = idOf(list, '仕事')
  const rest = idOf(list, '休息')
  await api.activities.archive({ id: rest })
  const yesterday = addDays(today, -1)

  // Act + Assert
  await expect(
    api.switches.replaceDay({
      day: yesterday,
      rows: [
        { activityId: work, startedAt: at(yesterday, 9) },
        { activityId: rest, startedAt: at(yesterday, 12) },
      ],
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
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

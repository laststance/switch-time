import { expect, test } from 'vitest'

import {
  clampStart,
  classifyDay,
  detoxCarriedDays,
  segmentsInRange,
  streak,
  sumSegments,
  summarizeDays,
  type DayFacts,
} from './stats'
import { addDays, dayBounds } from './time'

const H = 3_600_000
const TZ = 'Asia/Tokyo'
const at = (day: string, hour: number) => dayBounds(day, TZ).start + hour * H

test('segments are clipped to the day and the open one ends now', () => {
  // Arrange: 仕事 carried in from the evening before, 休息 from 09:00 and still running at 10:00
  const day = dayBounds('2026-09-09', TZ)
  const switches = [
    { id: 'a', activityId: 'work', startedAt: at('2026-09-08', 22) },
    { id: 'b', activityId: 'rest', startedAt: at('2026-09-09', 9) },
  ]

  // Act
  const segments = segmentsInRange(
    switches,
    day.start,
    day.end,
    at('2026-09-09', 10),
    12 * H,
  )

  // Assert: literal epochs, so a regression in localMidnight cannot shift inputs and expectations together.
  // 2026-09-09 in Asia/Tokyo: 00:00 = 1788879600000, 09:00 = 1788912000000, 10:00 = 1788915600000.
  expect(segments).toEqual([
    {
      switchId: 'a',
      activityId: 'work',
      start: 1788879600000,
      end: 1788912000000,
      idle: false,
    },
    {
      switchId: 'b',
      activityId: 'rest',
      start: 1788912000000,
      end: 1788915600000,
      idle: false,
    },
  ])
})

test('a segment longer than the idle threshold is flagged on its unclipped length', () => {
  // Arrange: 睡眠 20:00 → 09:00 is 13h, over a 12h threshold, although only 9h fall inside the day
  const day = dayBounds('2026-09-09', TZ)
  const switches = [
    { id: 'a', activityId: 'sleep', startedAt: at('2026-09-08', 20) },
    { id: 'b', activityId: 'work', startedAt: at('2026-09-09', 9) },
  ]

  // Act
  const sums = sumSegments(
    segmentsInRange(switches, day.start, day.end, at('2026-09-09', 18), 12 * H),
  )

  // Assert
  expect(sums).toEqual({ totals: { work: 9 * H }, idleMs: 9 * H, detoxMs: 0 })
})

test('detox time is neither totalled nor counted as idle', () => {
  // Arrange: 仕事 9:00, detox (no activity) 12:00, 休息 15:00, still running at 18:00
  const day = dayBounds('2026-09-09', TZ)
  const switches = [
    { id: 'a', activityId: 'work', startedAt: at('2026-09-09', 9) },
    { id: 'b', activityId: null, startedAt: at('2026-09-09', 12) },
    { id: 'c', activityId: 'rest', startedAt: at('2026-09-09', 15) },
  ]

  // Act
  const segments = segmentsInRange(
    switches,
    day.start,
    day.end,
    at('2026-09-09', 18),
    12 * H,
  )
  const sums = sumSegments(segments)

  // Assert: the detox span is still a segment (it is drawn), but it adds to no total and to no idle time
  expect(segments[1]).toEqual({
    switchId: 'b',
    activityId: null,
    start: at('2026-09-09', 12),
    end: at('2026-09-09', 15),
    idle: false,
  })
  expect(sums).toEqual({
    totals: { work: 3 * H, rest: 3 * H },
    idleMs: 0,
    detoxMs: 3 * H,
  })
})

test('a detox longer than the idle threshold is still detox, not idle', () => {
  // Arrange: 仕事 9:00, then detox from 10:00 still running at 1:00 the next day (15 h, over the 12 h threshold)
  const day = dayBounds('2026-09-09', TZ)
  const switches = [
    { id: 'a', activityId: 'work', startedAt: at('2026-09-09', 9) },
    { id: 'b', activityId: null, startedAt: at('2026-09-09', 10) },
  ]

  // Act
  const segments = segmentsInRange(
    switches,
    day.start,
    day.end,
    at('2026-09-10', 1),
    12 * H,
  )
  const sums = sumSegments(segments)

  // Assert: the span is flagged idle by its length, but its 14 h inside the day are detox time, in no total and not idle
  expect(segments[1]?.idle).toBe(true)
  expect(sums).toEqual({ totals: { work: 1 * H }, idleMs: 0, detoxMs: 14 * H })
})

test('a moved start never crosses its neighbours or the present', () => {
  // Act + Assert
  expect(clampStart(92 * H, 90 * H, 95 * H, 200 * H)).toBe(92 * H)
  expect(clampStart(100 * H, 90 * H, 95 * H, 200 * H)).toBe(95 * H - 60_000)
  expect(clampStart(80 * H, 90 * H, 95 * H, 200 * H)).toBe(90 * H + 60_000)
  expect(clampStart(200 * H + 300_000, null, null, 200 * H)).toBe(
    200 * H - 60_000,
  )
  // 90-second gap between neighbours: no slot keeps both segments >= 1 min
  expect(
    clampStart(90 * H + 45_000, 90 * H, 90 * H + 90_000, 200 * H),
  ).toBeNull()
})

const facts: DayFacts = {
  switchDays: new Set(['2026-09-05', '2026-09-06', '2026-09-08']),
  detoxDays: new Set(),
  manualExcluded: new Set(),
  firstDay: '2026-09-05',
  today: '2026-09-09',
  autoExcludeUnusedDays: true,
}

test('an untapped day is 計測なし and breaks the streak, while today only pauses it', () => {
  // Act + Assert
  expect(classifyDay('2026-09-07', facts)).toEqual({
    measured: false,
    excluded: 'auto_unused',
  })
  expect(classifyDay('2026-09-09', facts)).toEqual({
    measured: false,
    excluded: null,
  })
  expect(classifyDay('2026-09-04', facts)).toEqual({
    measured: false,
    excluded: null,
  })
  expect(streak(facts)).toBe(1)
})

test('with auto-exclusion off the carried-in state keeps every day measured', () => {
  // Arrange
  const relaxed = { ...facts, autoExcludeUnusedDays: false }

  // Act + Assert
  expect(classifyDay('2026-09-07', relaxed)).toEqual({
    measured: true,
    excluded: null,
  })
  expect(streak(relaxed)).toBe(5)
})

test('a manually excluded day is skipped by the streak instead of breaking it', () => {
  // Arrange
  const sick = {
    ...facts,
    switchDays: new Set(['2026-09-06', '2026-09-08', '2026-09-09']),
    manualExcluded: new Set(['2026-09-07']),
    firstDay: '2026-09-06',
  }

  // Act + Assert
  expect(classifyDay('2026-09-07', sick)).toEqual({
    measured: false,
    excluded: 'manual',
  })
  expect(streak(sick)).toBe(3)
})

test('range totals only include measured days and every excluded day is listed', () => {
  // Arrange: 09-06 仕事 9h then 休息 (38h, idle); 09-07 untapped; 09-08 仕事 10h, 娯楽 6h; 09-09 睡眠 7h, 仕事 3h so far
  const switches = [
    { id: 'a', activityId: 'work', startedAt: at('2026-09-06', 9) },
    { id: 'b', activityId: 'rest', startedAt: at('2026-09-06', 18) },
    { id: 'c', activityId: 'work', startedAt: at('2026-09-08', 8) },
    { id: 'd', activityId: 'fun', startedAt: at('2026-09-08', 18) },
    { id: 'e', activityId: 'sleep', startedAt: at('2026-09-09', 0) },
    { id: 'f', activityId: 'work', startedAt: at('2026-09-09', 7) },
  ]

  // Act
  const summary = summarizeDays({
    days: ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09'],
    switches,
    facts: {
      switchDays: new Set(['2026-09-06', '2026-09-08', '2026-09-09']),
      detoxDays: new Set(),
      manualExcluded: new Set(),
      firstDay: '2026-09-06',
      today: '2026-09-09',
      autoExcludeUnusedDays: true,
    },
    timeZone: TZ,
    now: at('2026-09-09', 10),
    idleThresholdMs: 12 * H,
  })

  // Assert
  expect(summary.days).toEqual([
    {
      day: '2026-09-06',
      measured: true,
      excluded: null,
      totals: { work: 9 * H },
      idleMs: 6 * H,
      detoxMs: 0,
    },
    {
      day: '2026-09-07',
      measured: false,
      excluded: 'auto_unused',
      totals: {},
      idleMs: 24 * H,
      detoxMs: 0,
    },
    {
      day: '2026-09-08',
      measured: true,
      excluded: null,
      totals: { work: 10 * H, fun: 6 * H },
      idleMs: 8 * H,
      detoxMs: 0,
    },
    {
      day: '2026-09-09',
      measured: true,
      excluded: null,
      totals: { sleep: 7 * H, work: 3 * H },
      idleMs: 0,
      detoxMs: 0,
    },
  ])
  expect(summary.totals).toEqual({ work: 22 * H, fun: 6 * H, sleep: 7 * H })
  expect(summary.measuredDays).toBe(3)
  expect(summary.streak).toBe(2)
  expect(summary.excludedDays).toEqual([
    { day: '2026-09-07', reason: 'auto_unused' },
  ])
})

const SEPTEMBER = { from: '2026-09-01', to: '2026-09-09' }

test('a detox left on over a weekend covers the untapped days until the next tap', () => {
  // Arrange: detox from Friday 22:00, 仕事 on Monday 09:00 (taps out of order, as the query returns them)
  const taps = [
    { activityId: 'work', startedAt: at('2026-09-07', 9) },
    { activityId: null, startedAt: at('2026-09-04', 22) },
  ]

  // Act
  const days = detoxCarriedDays(taps, TZ, SEPTEMBER)

  // Assert
  expect([...days]).toEqual(['2026-09-05', '2026-09-06'])
})

test('a detox still running covers every day through today', () => {
  // Arrange
  const taps = [
    { activityId: 'work', startedAt: at('2026-09-07', 9) },
    { activityId: null, startedAt: at('2026-09-07', 20) },
  ]

  // Act
  const days = detoxCarriedDays(taps, TZ, SEPTEMBER)

  // Assert
  expect([...days]).toEqual(['2026-09-08', '2026-09-09'])
})

test('a detox ended the same day and an activity left running cover no day', () => {
  // Arrange: detox 12:00–13:00 on 09-02, then 仕事 left running from 09-02 13:00 over the next days
  const taps = [
    { activityId: null, startedAt: at('2026-09-02', 12) },
    { activityId: 'work', startedAt: at('2026-09-02', 13) },
  ]

  // Act
  const days = detoxCarriedDays(taps, TZ, SEPTEMBER)

  // Assert
  expect([...days]).toEqual([])
})

test('a detox across the New York DST change covers the untapped day in local days', () => {
  // Arrange: detox from 23:30 on 2026-10-31, the night before clocks fall back, until 08:00 on 11-02
  const zone = 'America/New_York'
  const taps = [
    {
      activityId: null,
      startedAt: dayBounds('2026-10-31', zone).start + 23.5 * H,
    },
    {
      activityId: 'work',
      startedAt: dayBounds('2026-11-02', zone).start + 8 * H,
    },
  ]

  // Act
  const days = detoxCarriedDays(taps, zone, {
    from: '2026-10-01',
    to: '2026-11-05',
  })

  // Assert
  expect([...days]).toEqual(['2026-11-01'])
})

test('a detox older than the window reports only the window days it runs through', () => {
  // Arrange: a detox tapped 4000 days before today and still running
  const today = '2026-09-09'
  const taps = [
    { activityId: null, startedAt: dayBounds(addDays(today, -4000), TZ).start },
  ]

  // Act
  const streakWindow = detoxCarriedDays(taps, TZ, {
    from: addDays(today, -3650),
    to: today,
  })
  const oldMonth = detoxCarriedDays(taps, TZ, {
    from: addDays(today, -3999),
    to: today,
  })

  // Assert
  expect(streakWindow.size).toBe(3651)
  expect(streakWindow.has('2026-09-08')).toBe(true)
  expect(oldMonth.has(addDays(today, -3999))).toBe(true)
})

test('days a detox runs through are measured, keep the streak and still yield to a manual exclusion', () => {
  // Arrange: tapped 09-05, detox from 09-05 evening through today 09-09, 09-07 excluded by hand
  const detoxWeek: DayFacts = {
    switchDays: new Set(['2026-09-05']),
    detoxDays: new Set([
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ]),
    manualExcluded: new Set(['2026-09-07']),
    firstDay: '2026-09-05',
    today: '2026-09-09',
    autoExcludeUnusedDays: true,
  }

  // Act + Assert
  expect(classifyDay('2026-09-06', detoxWeek)).toEqual({
    measured: true,
    excluded: null,
  })
  expect(classifyDay('2026-09-07', detoxWeek)).toEqual({
    measured: false,
    excluded: 'manual',
  })
  expect(classifyDay('2026-09-09', detoxWeek)).toEqual({
    measured: true,
    excluded: null,
  })
  expect(streak(detoxWeek)).toBe(4)
})

test('a detox weekend counts as measured days with nothing added to the totals', () => {
  // Arrange: 仕事 09-04 09:00, detox from 18:00 until 仕事 on 09-07 09:00, still running at 10:00
  const switches = [
    { id: 'a', activityId: 'work', startedAt: at('2026-09-04', 9) },
    { id: 'b', activityId: null, startedAt: at('2026-09-04', 18) },
    { id: 'c', activityId: 'work', startedAt: at('2026-09-07', 9) },
  ]

  // Act
  const summary = summarizeDays({
    days: ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'],
    switches,
    facts: {
      switchDays: new Set(['2026-09-04', '2026-09-07']),
      detoxDays: detoxCarriedDays(switches, TZ, {
        from: '2026-09-04',
        to: '2026-09-07',
      }),
      manualExcluded: new Set(),
      firstDay: '2026-09-04',
      today: '2026-09-07',
      autoExcludeUnusedDays: true,
    },
    timeZone: TZ,
    now: at('2026-09-07', 10),
    idleThresholdMs: 12 * H,
  })

  // Assert
  expect(
    summary.days.map((day) => [day.day, day.measured, day.detoxMs]),
  ).toEqual([
    ['2026-09-04', true, 6 * H],
    ['2026-09-05', true, 24 * H],
    ['2026-09-06', true, 24 * H],
    ['2026-09-07', true, 9 * H],
  ])
  expect(summary.totals).toEqual({ work: 10 * H })
  expect(summary.measuredDays).toBe(4)
  expect(summary.streak).toBe(4)
  expect(summary.excludedDays).toEqual([])
})

import { expect, test } from 'vitest'

import {
  clampStart,
  classifyDay,
  segmentsInRange,
  streak,
  sumSegments,
  summarizeDays,
  type DayFacts,
} from './stats'
import { dayBounds } from './time'

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

  // Assert
  expect(segments).toEqual([
    {
      switchId: 'a',
      activityId: 'work',
      start: day.start,
      end: at('2026-09-09', 9),
      idle: false,
    },
    {
      switchId: 'b',
      activityId: 'rest',
      start: at('2026-09-09', 9),
      end: at('2026-09-09', 10),
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
  expect(sums).toEqual({ totals: { work: 9 * H }, idleMs: 9 * H })
})

test('a moved start never crosses its neighbours or the present', () => {
  // Act + Assert
  expect(clampStart(92 * H, 90 * H, 95 * H, 200 * H)).toBe(92 * H)
  expect(clampStart(100 * H, 90 * H, 95 * H, 200 * H)).toBe(95 * H - 60_000)
  expect(clampStart(80 * H, 90 * H, 95 * H, 200 * H)).toBe(90 * H + 60_000)
  expect(clampStart(200 * H + 300_000, null, null, 200 * H)).toBe(
    200 * H - 60_000,
  )
})

const facts: DayFacts = {
  switchDays: new Set(['2026-09-05', '2026-09-06', '2026-09-08']),
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
    },
    {
      day: '2026-09-07',
      measured: false,
      excluded: 'auto_unused',
      totals: {},
      idleMs: 24 * H,
    },
    {
      day: '2026-09-08',
      measured: true,
      excluded: null,
      totals: { work: 10 * H, fun: 6 * H },
      idleMs: 8 * H,
    },
    {
      day: '2026-09-09',
      measured: true,
      excluded: null,
      totals: { sleep: 7 * H, work: 3 * H },
      idleMs: 0,
    },
  ])
  expect(summary.totals).toEqual({ work: 22 * H, fun: 6 * H, sleep: 7 * H })
  expect(summary.measuredDays).toBe(3)
  expect(summary.streak).toBe(2)
  expect(summary.excludedDays).toEqual([
    { day: '2026-09-07', reason: 'auto_unused' },
  ])
})

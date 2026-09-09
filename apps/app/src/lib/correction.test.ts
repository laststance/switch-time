import { dayBounds } from '@switch-time/shared'
import { expect, test } from 'vitest'

import {
  correctionRows,
  daySnapshot,
  dayTitle,
  type ListedDay,
} from './correction'

const TZ = 'Asia/Tokyo'
const MIN = 60_000
const at = (day: string, hour: number, minute = 0) =>
  new Date(dayBounds(day, TZ).start + hour * 60 * MIN + minute * MIN)
const row = (id: string, activityId: string, startedAt: Date) => ({
  id,
  userId: 'u',
  activityId,
  startedAt,
  source: 'tap' as const,
  createdAt: startedAt,
})
const activities = [
  { id: 'work', name: '仕事', color: '#3B7BD9', iconKey: 'work' },
  { id: 'rest', name: '休息', color: '#4FA877', iconKey: 'rest' },
  { id: 'fun', name: '娯楽', color: '#D8579C', iconKey: 'fun' },
  { id: 'sleep', name: '睡眠', color: '#6C63D6', iconKey: 'sleep' },
  { id: 'home', name: '家事', color: '#E0A431', iconKey: 'home' },
]
const flags = (r: ReturnType<typeof correctionRows>[number]) => [
  r.name,
  r.range,
  r.duration,
  r.editable,
  r.canMoveEarlier,
  r.canMoveLater,
  r.canMerge,
  r.canSplit,
]

test('a past day lists the carried-in state last and read-only, and clips the open state at 24:00', () => {
  // Arrange: 睡眠 from the night before, three rows on 9/8, the next switch on 9/9 (so 娯楽 really ends at 24:00).
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('s', 'sleep', at('2026-09-07', 23)),
    rows: [
      row('w', 'work', at(day, 9)),
      row('r', 'rest', at(day, 12)),
      row('f', 'fun', at(day, 18)),
    ],
    carriedOut: row('h', 'home', at('2026-09-09', 9, 55)),
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const rows = correctionRows(list, activities, bounds)

  // Assert: 娯楽 cannot split (its midpoint falls on 9/9); 仕事 merges into the carried-in 睡眠.
  expect(rows.map(flags)).toEqual([
    ['娯楽', '18:00 – 24:00', '6h 00m', true, true, true, true, false],
    ['休息', '12:00 – 18:00', '6h 00m', true, true, true, true, true],
    ['仕事', '9:00 – 12:00', '3h 00m', true, true, true, true, true],
    ['睡眠', '0:00 – 9:00', '9h 00m', false, false, false, false, false],
  ])
  expect(rows.map((r) => [r.id, r.color, r.iconKey])).toEqual([
    ['f', '#D8579C', 'fun'],
    ['r', '#4FA877', 'rest'],
    ['w', '#3B7BD9', 'work'],
    ['s', '#6C63D6', 'sleep'],
  ])
  expect(rows.map((r) => r.startLabel)).toEqual([
    '18:00',
    '12:00',
    '9:00',
    '0:00',
  ])
  expect(rows[0]?.start).toBe(at(day, 18).getTime())
  expect(rows[0]?.end).toBe(bounds.end)
  expect(rows[3]?.start).toBe(bounds.start)
})

test('today keeps the first row at or after 0:00 and the current row out of the future', () => {
  // Arrange: 仕事 since midnight (so the carried-in 睡眠 has nothing left to show), 家事 tapped one minute ago.
  const day = '2026-09-09'
  const list: ListedDay = {
    carriedIn: row('s', 'sleep', at('2026-09-08', 23)),
    rows: [row('w', 'work', at(day, 0)), row('h', 'home', at(day, 9, 59))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at(day, 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const rows = correctionRows(list, activities, bounds)

  // Assert: 家事 cannot move later (now − 1 min is where it is) nor split (a 30 s half); 仕事 cannot move before 0:00 but
  // merges into the carried-in state; the zero-length 睡眠 row is not listed.
  expect(rows.map(flags)).toEqual([
    ['家事', '9:59 – いま', '1m', true, true, false, true, false],
    ['仕事', '0:00 – 9:59', '9h 59m', true, false, true, true, true],
  ])
  expect(correctionRows(undefined, activities, bounds)).toEqual([])
  expect(correctionRows(list, undefined, bounds)).toEqual([])
})

test('the title names the day unless it is today, and the snapshot holds only the day’s own rows', () => {
  // Arrange
  const list: ListedDay = {
    carriedIn: row('s', 'sleep', at('2026-09-07', 23)),
    rows: [row('w', 'work', at('2026-09-08', 9))],
    carriedOut: null,
  }

  // Act & Assert
  expect(dayTitle('2026-09-09', '2026-09-09')).toBe('今日の記録を訂正')
  expect(dayTitle('2026-09-08', '2026-09-09')).toBe('9月8日（火）の記録を訂正')
  expect(daySnapshot(list)).toEqual([
    { activityId: 'work', startedAt: at('2026-09-08', 9) },
  ])
})

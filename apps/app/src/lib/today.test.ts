import { expect, test } from 'vitest'

import { countSwitches, daySegments } from './today'

const row = (id: string, activityId: string, startedAt: string) => ({
  id,
  activityId,
  startedAt: new Date(startedAt),
})
const start = Date.parse('2026-09-08T15:00:00Z') // 2026-09-09 00:00 JST
const end = Date.parse('2026-09-09T15:00:00Z')

test('the bar carries yesterday’s state in and stops the current segment at now', () => {
  // Arrange
  const list = {
    carriedIn: row('a', 'sleep', '2026-09-08T14:00:00Z'),
    rows: [row('b', 'work', '2026-09-09T00:00:00Z')],
  }
  const now = Date.parse('2026-09-09T01:30:00Z')

  // Act
  const segments = daySegments(list, start, end, now, 720 * 60_000)

  // Assert
  expect(segments).toEqual([
    {
      switchId: 'a',
      activityId: 'sleep',
      start,
      end: Date.parse('2026-09-09T00:00:00Z'),
      idle: false,
    },
    {
      switchId: 'b',
      activityId: 'work',
      start: Date.parse('2026-09-09T00:00:00Z'),
      end: now,
      idle: false,
    },
  ])
  expect(daySegments(undefined, start, end, now, 720 * 60_000)).toEqual([])
})

test('the first row of a first day is the starting state, not a switch', () => {
  // Arrange
  const first = row('a', 'house', '2026-09-09T00:00:00Z')
  const second = row('b', 'work', '2026-09-09T01:00:00Z')

  // Act
  const firstDay = countSwitches({ carriedIn: null, rows: [first, second] })
  const laterDay = countSwitches({ carriedIn: first, rows: [second] })

  // Assert
  expect(firstDay).toBe(1)
  expect(laterDay).toBe(1)
  expect(countSwitches({ carriedIn: null, rows: [first] })).toBe(0)
  expect(countSwitches(undefined)).toBe(0)
})

import { expect, test } from 'vitest'

import { countSwitches, daySegments, legendEntries, spanCorners } from './today'

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

test('the legend names each activity with a span today and adds detox when time was recorded to nothing', () => {
  // Arrange: 仕事 and 睡眠 drew spans, 家事 did not; one span is detox
  const activities = [
    { id: 'home', name: '家事', color: '#E0A431' },
    { id: 'work', name: '仕事', color: '#3B7BD9' },
    { id: 'sleep', name: '睡眠', color: '#6C63D6' },
  ]
  const segments = [
    { activityId: 'sleep' },
    { activityId: 'work' },
    { activityId: null },
    { activityId: 'work' },
  ]

  // Act
  const legend = legendEntries(activities, segments)

  // Assert: list order rather than span order, detox last and without a colour; no detox entry without a detox span
  expect(legend).toEqual([
    { id: 'work', name: '仕事', color: '#3B7BD9' },
    { id: 'sleep', name: '睡眠', color: '#6C63D6' },
    { id: 'detox', name: 'detox', color: null },
  ])
  expect(legendEntries(activities, [{ activityId: 'work' }])).toEqual([
    { id: 'work', name: '仕事', color: '#3B7BD9' },
  ])
})

test('a span touching an end of the bar takes that end’s rounded corner, so its outline is not clipped open', () => {
  // Arrange: a 0:00–24:00 bar in ms and its own corner classes
  const bounds = { start: 0, end: 86_400_000 }
  const corners = { first: 'rounded-l-md', last: 'rounded-r-md' }

  // Act
  const carriedIn = spanCorners(
    { start: -3_600_000, end: 3_600_000 },
    bounds,
    corners,
  )
  const running = spanCorners(
    { start: 82_800_000, end: 86_400_000 },
    bounds,
    corners,
  )
  const wholeDay = spanCorners({ start: 0, end: 86_400_000 }, bounds, corners)
  const inside = spanCorners(
    { start: 3_600_000, end: 7_200_000 },
    bounds,
    corners,
  )

  // Assert: a span reaching past the start counts as touching it; a span inside the bar keeps square ends
  expect(carriedIn).toBe('rounded-l-md')
  expect(running).toBe('rounded-r-md')
  expect(wholeDay).toBe('rounded-l-md rounded-r-md')
  expect(inside).toBe('')
})

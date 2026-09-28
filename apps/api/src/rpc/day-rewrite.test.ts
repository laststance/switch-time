import { expect, test } from 'vitest'

import { rewritePlan, rewriteSpan } from './day-rewrite'

const at = (hour: number) => new Date(Date.UTC(2026, 8, 8, hour))
const window = { start: at(0).getTime(), end: at(24).getTime() }
const row = (activityId: string, hour: number) => ({
  activityId,
  startedAt: at(hour),
})
const wholeDay = window

test('a rewrite without a range covers the whole day', () => {
  // Act
  const span = rewriteSpan(window, undefined)

  // Assert
  expect(span).toEqual({ start: at(0).getTime(), end: at(24).getTime() })
})

test('a rewrite with a range inside the day covers just that range', () => {
  // Act
  const span = rewriteSpan(window, { from: at(9), to: at(10) })

  // Assert
  expect(span).toEqual({ start: at(9).getTime(), end: at(10).getTime() })
})

test('a range that starts before the day or ends after it is refused as bad input', () => {
  // Act
  const early = () => rewriteSpan(window, { from: at(-1), to: at(10) })
  const late = () => rewriteSpan(window, { from: at(9), to: at(25) })

  // Assert
  expect(early).toThrow('range must fall inside the day')
  expect(late).toThrow('range must fall inside the day')
})

test('a whole-day rewrite makes its last row the current state and moves the carried-in record', () => {
  // Arrange
  const current = [row('work', 9), row('rest', 10)]
  const rows = [row('work', 9), row('fun', 10)]

  // Act
  const plan = rewritePlan(current, wholeDay, rows, null, row('sleep', -1))

  // Assert
  expect(plan).toEqual({ latest: row('fun', 10), bumpCarriedIn: true })
})

test('a whole-day rewrite to nothing hands the current state back to the carried-in record', () => {
  // Arrange
  const carriedIn = row('sleep', -1)

  // Act
  const plan = rewritePlan([row('work', 9)], wholeDay, [], null, carriedIn)

  // Assert
  expect(plan).toEqual({ latest: carriedIn, bumpCarriedIn: true })
})

test('a switch after the day stays the current state, so no row of the day is checked', () => {
  // Act
  const plan = rewritePlan(
    [row('work', 9)],
    wholeDay,
    [row('work', 9)],
    { id: 'next' },
    null,
  )

  // Assert
  expect(plan.latest).toBeNull()
})

test('a range that stops short of the last row leaves that row the current state and the carried-in record alone', () => {
  // Arrange: a range on the 10:00 row of a three-row day
  const current = [row('work', 9), row('rest', 10), row('work', 11)]
  const span = { start: at(10).getTime(), end: at(11).getTime() }

  // Act
  const plan = rewritePlan(
    current,
    span,
    [row('fun', 10)],
    null,
    row('sleep', -1),
  )

  // Assert
  expect(plan).toEqual({ latest: null, bumpCarriedIn: false })
})

test('a range that empties the end of the day hands the current state to the row before it', () => {
  // Arrange: a range from the 10:00 row to the end of the day, written back as nothing
  const current = [row('work', 9), row('rest', 10)]
  const span = { start: at(10).getTime(), end: window.end }

  // Act
  const plan = rewritePlan(current, span, [], null, null)

  // Assert
  expect(plan).toEqual({ latest: row('work', 9), bumpCarriedIn: false })
})

test('a range that reaches the first row of the day moves the carried-in record', () => {
  // Arrange
  const current = [row('work', 9), row('rest', 10)]
  const span = { start: at(9).getTime(), end: at(10).getTime() }

  // Act
  const plan = rewritePlan(
    current,
    span,
    [row('fun', 9)],
    null,
    row('sleep', -1),
  )

  // Assert
  expect(plan.bumpCarriedIn).toBe(true)
})

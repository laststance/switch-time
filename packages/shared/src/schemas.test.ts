import { expect, test } from 'vitest'

import {
  DAY_ROWS_MAX,
  daySchema,
  monthSchema,
  reorderInputSchema,
  replaceDayInputSchema,
  switchToInputSchema,
  UNDO_ROWS_MAX,
} from './schemas'

test('a day before 1970 or without a plain four-digit year is refused', () => {
  // Act
  const refused = ['0999-06-01', '1969-12-31', '+02026-01-01', '2026-9-01'].map(
    (day) => daySchema.safeParse(day).success,
  )

  // Assert
  expect(refused).toEqual([false, false, false, false])
})

test('the first day of 1970 and an ordinary day are accepted', () => {
  // Act
  const accepted = ['1970-01-01', '2026-09-25'].map(
    (day) => daySchema.safeParse(day).success,
  )

  // Assert
  expect(accepted).toEqual([true, true])
})

test('a month before 1970 is refused and January 1970 is accepted', () => {
  // Act
  const results = ['1969-12', '0999-06', '1970-01', '2026-09'].map(
    (month) => monthSchema.safeParse(month).success,
  )

  // Assert
  expect(results).toEqual([false, false, true, true])
})

test('a day or month so late that a week after it would pass year 9999 is refused', () => {
  // Act
  const days = ['9999-11-30', '9999-12-01', '9999-12-31'].map(
    (day) => daySchema.safeParse(day).success,
  )
  const months = ['9999-11', '9999-12'].map(
    (month) => monthSchema.safeParse(month).success,
  )

  // Assert
  expect(days).toEqual([true, false, false])
  expect(months).toEqual([true, false])
})

test('a reorder can name a full grid of 100 activities, and one more id is refused', () => {
  // Arrange: distinct v4 uuids, 101 of them
  const ids = Array.from(
    { length: 101 },
    (_, index) =>
      `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
  )

  // Act
  const full = reorderInputSchema.safeParse({ ids: ids.slice(0, 100) }).success
  const overFull = reorderInputSchema.safeParse({ ids }).success

  // Assert
  expect([full, overFull]).toEqual([true, false])
})

test('a reorder that names one activity twice is refused before it reaches the live set check', () => {
  // Arrange
  const work = '00000000-0000-4000-8000-000000000001'
  const rest = '00000000-0000-4000-8000-000000000002'

  // Act
  const repeated = reorderInputSchema.safeParse({ ids: [work, rest, work] })

  // Assert
  expect(repeated.success).toBe(false)
})

test('a tap from a tab still on the previous bundle, with no account or wait, is accepted', () => {
  // Arrange
  const tap = { activityId: null }

  // Act
  const parsed = switchToInputSchema.safeParse(tap)

  // Assert
  expect(parsed.success).toBe(true)
})

test('a tap with its account and its wait on the device is accepted', () => {
  // Arrange
  const tap = {
    activityId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    forUserId: 'user-1',
    waitedMs: 4000,
  }

  // Act
  const parsed = switchToInputSchema.safeParse(tap)

  // Assert
  expect(parsed.success).toBe(true)
})

test('a tap with a negative or fractional wait is refused', () => {
  // Arrange
  const negative = { activityId: null, waitedMs: -1 }
  const fractional = { activityId: null, waitedMs: 1.5 }

  // Act
  const parsedNegative = switchToInputSchema.safeParse(negative)
  const parsedFractional = switchToInputSchema.safeParse(fractional)

  // Assert
  expect(parsedNegative.success).toBe(false)
  expect(parsedFractional.success).toBe(false)
})

// A 元に戻す request's rows: `count` rows of detox, one minute apart.
const undoRows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    activityId: null,
    startedAt: new Date(Date.UTC(2026, 8, 28, 0, index)),
  }))
const undoCall = { day: '2026-09-28', timeZone: 'Asia/Tokyo' }

test('元に戻す names what the day should hold as a row list or a digest, never both and never neither', () => {
  // Act
  const accepted = [
    { expected: [] },
    { expectedDigest: '0:bdcb81aee8d83' },
    { expected: [], expectedDigest: '0:bdcb81aee8d83' },
    {},
  ].map(
    (expectation) =>
      replaceDayInputSchema.safeParse({
        ...undoCall,
        ...expectation,
        rows: [],
      }).success,
  )

  // Assert
  expect(accepted).toEqual([true, true, false, false])
})

test('元に戻す writes back up to 600 rows on a busy day named by its digest, and up to 300 with a row list', () => {
  // Act
  const accepted = [
    { expectedDigest: '600:1', rows: undoRows(UNDO_ROWS_MAX) },
    { expectedDigest: '601:1', rows: undoRows(UNDO_ROWS_MAX + 1) },
    { expected: [], rows: undoRows(DAY_ROWS_MAX) },
    { expected: [], rows: undoRows(DAY_ROWS_MAX + 1) },
  ].map(
    (call) => replaceDayInputSchema.safeParse({ ...undoCall, ...call }).success,
  )

  // Assert
  expect(accepted).toEqual([true, false, true, false])
})

test('元に戻す takes a range only when it starts before it ends', () => {
  // Act
  const accepted = [
    { from: '2026-09-28T01:00:00Z', to: '2026-09-28T02:00:00Z' },
    { from: '2026-09-28T02:00:00Z', to: '2026-09-28T02:00:00Z' },
    { from: '2026-09-28T03:00:00Z', to: '2026-09-28T02:00:00Z' },
  ].map(
    (range) =>
      replaceDayInputSchema.safeParse({
        ...undoCall,
        expectedDigest: '0:1',
        range,
        rows: [],
      }).success,
  )

  // Assert
  expect(accepted).toEqual([true, false, false])
})

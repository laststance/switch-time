import { expect, test } from 'vitest'

import { daySchema, monthSchema, reorderInputSchema } from './schemas'

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

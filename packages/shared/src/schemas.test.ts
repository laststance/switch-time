import { expect, test } from 'vitest'

import { daySchema, monthSchema } from './schemas'

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

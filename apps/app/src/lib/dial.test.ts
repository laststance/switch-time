import { expect, test } from 'vitest'

import { handAngles } from './dial'

test('the hour hand sits between the numerals at half past', () => {
  // Arrange
  const halfPastThree = new Date(2026, 8, 9, 15, 30, 0)

  // Act
  const angles = handAngles(halfPastThree)

  // Assert
  expect(angles).toEqual({ hour: 105, minute: 180, second: 0 })
})

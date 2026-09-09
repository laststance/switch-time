import { expect, test } from 'vitest'

import { hotkeyIndex } from './hotkeys'

test('digits pick activities by position and modifier combos are left to the browser', () => {
  // Arrange
  const press = (key: string, metaKey = false) => ({
    key,
    metaKey,
    ctrlKey: false,
    altKey: false,
  })

  // Act
  const picks = [
    press('1'),
    press('6'),
    press('0'),
    press('a'),
    press('1', true),
  ].map(hotkeyIndex)

  // Assert
  expect(picks.slice(0, 2)).toEqual([0, 5])
  expect(picks.slice(2)).toEqual([-1, NaN, -1])
})

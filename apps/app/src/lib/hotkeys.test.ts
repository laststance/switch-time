import { expect, test } from 'vitest'

import { hotkeyIndex, isDetoxHotkey } from './hotkeys'

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

test('the plain 0 starts detox, a modifier combo or another digit does not', () => {
  // Arrange
  const press = (
    key: string,
    held: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {},
  ) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...held })

  // Act: ⌘0 switches browser tabs, ⌃0 and ⌥0 are the browser's too
  const detox = [
    press('0'),
    press('0', { metaKey: true }),
    press('0', { ctrlKey: true }),
    press('0', { altKey: true }),
    press('1'),
  ].map(isDetoxHotkey)

  // Assert
  expect(detox).toEqual([true, false, false, false, false])
})

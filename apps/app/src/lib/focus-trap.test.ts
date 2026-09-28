import { expect, test } from 'vitest'

import { trappedFocus } from './focus-trap'

test('Tab on a sheet’s last control wraps to its first control instead of leaving the sheet', () => {
  // Act
  const target = trappedFocus(3, 2, false)

  // Assert
  expect(target).toBe(0)
})

test('Shift+Tab on a sheet’s first control wraps to its last control', () => {
  // Act
  const target = trappedFocus(3, 0, true)

  // Assert
  expect(target).toBe(2)
})

test('Tab from the sheet itself, where focus starts, enters at the first control, and Shift+Tab at the last', () => {
  // Act
  const forward = trappedFocus(3, -1, false)
  const backward = trappedFocus(3, -1, true)

  // Assert
  expect(forward).toBe(0)
  expect(backward).toBe(2)
})

test('Tab between two controls inside the sheet is left to the browser', () => {
  // Act
  const forward = trappedFocus(3, 1, false)
  const backward = trappedFocus(3, 1, true)

  // Assert
  expect(forward).toBe('browser')
  expect(backward).toBe('browser')
})

test('a sheet with no focusable control leaves Tab to the browser', () => {
  // Act
  const target = trappedFocus(0, -1, false)

  // Assert
  expect(target).toBe('browser')
})

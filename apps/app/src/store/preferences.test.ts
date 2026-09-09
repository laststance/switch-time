import { expect, test } from 'vitest'

import { resolveTheme } from './preferences'

test('theme auto resolves to light between 06:00 and 18:00', () => {
  // Arrange
  const at = (hour: number, minute: number) =>
    new Date(2026, 8, 9, hour, minute)

  // Act
  const bands = [at(5, 59), at(6, 0), at(17, 59), at(18, 0)].map((now) =>
    resolveTheme('auto', now),
  )

  // Assert
  expect(bands).toEqual(['dark', 'light', 'light', 'dark'])
  expect(resolveTheme('light', at(23, 0))).toBe('light')
  expect(resolveTheme('dark', at(12, 0))).toBe('dark')
})

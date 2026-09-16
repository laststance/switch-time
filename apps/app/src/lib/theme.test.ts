import { expect, test } from 'vitest'

import { THEME_BG, resolveTheme } from './theme'

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

test('browser chrome colours are the design bg tokens', () => {
  // Arrange / Act / Assert
  expect(THEME_BG.light).toBe('#f5f2eb')
  expect(THEME_BG.dark).toBe('#111216')
})

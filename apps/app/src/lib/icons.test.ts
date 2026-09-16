import { expect, test } from 'vitest'

import { DETOX } from './detox'
import { activityIcon, cycleIcon } from './icons'

test('the detox row draws the wind glyph while a renamed custom activity still draws the house', () => {
  // Arrange
  const house = 'M3 11 12 3l9 8v10H3z'

  // Act
  const glyphs = [
    activityIcon(DETOX.iconKey),
    activityIcon('reading'),
    activityIcon('work'),
  ]

  // Assert: detox's key resolves to the wind path, an unknown key falls back to the house, an activity key keeps its glyph
  expect(glyphs).toEqual([
    'M12.8 19.6A2 2 0 1 0 14 16H2M17.5 8a2.5 2.5 0 1 1 2 4H2M9.8 4.4A2 2 0 1 1 11 8H2',
    house,
    'M3 8h18v12H3zM9 8V5h6v3M3 13h18',
  ])
})

test('the icon editor never cycles onto the detox glyph', () => {
  // Arrange: the last activity glyph in the design's order, and detox's own key
  const last = 'fun'

  // Act
  const next = [cycleIcon(last), cycleIcon(DETOX.iconKey)]

  // Assert: the cycle wraps to the house without passing wind, and wind itself restarts it like any unknown key
  expect(next).toEqual(['home', 'home'])
})

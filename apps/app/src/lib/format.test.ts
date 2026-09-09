import { expect, test } from 'vitest'

import { formatDay, formatDuration, formatElapsed, formatTime } from './format'

test('the elapsed hero reads H:MM:SS and keeps counting past 24 hours', () => {
  // Arrange
  const cases = [59_000, 3_600_000, 98_103_000, -5_000]

  // Act
  const readouts = cases.map(formatElapsed)

  // Assert
  expect(readouts).toEqual(['0:00:59', '1:00:00', '27:15:03', '0:00:00'])
})

test('the header date and the since line follow the stored time zone', () => {
  // Arrange
  const instant = new Date('2026-09-09T00:05:00Z')

  // Act
  const day = formatDay('2026-09-09')
  const tokyo = formatTime(instant, 'Asia/Tokyo')
  const newYork = formatTime(instant, 'America/New_York')

  // Assert
  expect(day).toBe('9月9日（水）')
  expect(tokyo).toBe('9:05')
  expect(newYork).toBe('20:05')
})

test('durations read as hours and padded minutes, minutes alone under an hour', () => {
  // Arrange
  const cases = [19 * 3_600_000, 22_800_000, 45 * 60_000, 29_999, 0]

  // Act
  const readouts = cases.map(formatDuration)

  // Assert
  expect(readouts).toEqual(['19h 00m', '6h 20m', '45m', '0m', '0m'])
})

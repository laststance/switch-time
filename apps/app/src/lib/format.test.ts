import { afterEach, expect, test, vi } from 'vitest'

import {
  formatDay,
  formatDuration,
  formatElapsed,
  formatSince,
  formatTime,
} from './format'

afterEach(() => {
  vi.restoreAllMocks()
})

test('the elapsed hero reads H:MM:SS and keeps counting past 24 hours', () => {
  // Arrange
  const cases = [59_000, 3_600_000, 98_103_000, -5_000]

  // Act
  const readouts = cases.map(formatElapsed)

  // Assert
  expect(readouts).toEqual(['0:00:59', '1:00:00', '27:15:03', '0:00:00'])
})

test('the since line builds one formatter per time zone, however often it renders', () => {
  // Arrange: zones no other test here formats, so the cache starts empty for them
  const construct = vi.spyOn(Intl, 'DateTimeFormat')
  const instant = new Date('2026-09-09T00:05:00Z')

  // Act
  const readouts = [
    formatTime(instant, 'Europe/Lisbon'),
    formatTime(instant, 'Asia/Kolkata'),
    formatTime(instant, 'Europe/Lisbon'),
    formatTime(instant, 'Asia/Kolkata'),
  ]

  // Assert
  expect(readouts).toEqual(['1:05', '5:35', '1:05', '5:35'])
  expect(construct).toHaveBeenCalledTimes(2)
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

test('the since line keeps failing for an unknown time zone instead of caching a broken formatter', () => {
  // Arrange
  const instant = new Date('2026-09-09T00:05:00Z')

  // Act
  const readUnknownZone = () => formatTime(instant, 'Mars/Olympus_Mons')

  // Assert
  expect(readUnknownZone).toThrow(RangeError)
  expect(readUnknownZone).toThrow(RangeError)
  expect(formatTime(instant, 'Asia/Tokyo')).toBe('9:05')
})

test('the since line names the day for a record started before today, and stays a bare time for one started today', () => {
  // Arrange: a detox from 9/16 21:20 JST and a switch at 9/25 0:05 JST, read on 9/25 in Tokyo
  const carried = new Date('2026-09-16T12:20:00Z')
  const sameDay = new Date('2026-09-24T15:05:00Z')

  // Act
  const carriedLabel = formatSince(carried, '2026-09-25', 'Asia/Tokyo')
  const sameDayLabel = formatSince(sameDay, '2026-09-25', 'Asia/Tokyo')

  // Assert
  expect(carriedLabel).toBe('9月16日 21:20')
  expect(sameDayLabel).toBe('0:05')
})

test('the since line judges "today" in the stored zone, not in UTC', () => {
  // Arrange: 9/24 23:30 UTC is already 9/25 8:30 in Tokyo but still 9/24 19:30 in New York
  const instant = new Date('2026-09-24T23:30:00Z')

  // Act
  const tokyo = formatSince(instant, '2026-09-25', 'Asia/Tokyo')
  const newYork = formatSince(instant, '2026-09-25', 'America/New_York')

  // Assert
  expect(tokyo).toBe('8:30')
  expect(newYork).toBe('9月24日 19:30')
})

import { afterEach, expect, test, vi } from 'vitest'

import {
  addDays,
  dayBounds,
  daysInMonth,
  isCalendarDay,
  isTimeZone,
  localDay,
  tzOffsetMs,
} from './time'

afterEach(() => {
  vi.restoreAllMocks()
})

test('a Tokyo day runs from 15:00 UTC of the previous day', () => {
  // Act
  const bounds = dayBounds('2026-09-09', 'Asia/Tokyo')

  // Assert
  expect(bounds).toEqual({
    start: Date.parse('2026-09-08T15:00:00Z'),
    end: Date.parse('2026-09-09T15:00:00Z'),
  })
})

test('the DST-start day in New York is 23 hours long', () => {
  // Act
  const bounds = dayBounds('2026-03-08', 'America/New_York')

  // Assert
  expect(bounds).toEqual({
    start: Date.parse('2026-03-08T05:00:00Z'),
    end: Date.parse('2026-03-09T04:00:00Z'),
  })
})

test('the local day flips at Tokyo midnight, not UTC midnight', () => {
  // Act + Assert
  expect(localDay(new Date('2026-09-09T14:59:59Z'), 'Asia/Tokyo')).toBe(
    '2026-09-09',
  )
  expect(localDay(new Date('2026-09-09T15:00:00Z'), 'Asia/Tokyo')).toBe(
    '2026-09-10',
  )
})

test('the offset is positive east of Greenwich and negative west of it', () => {
  // Arrange
  const instant = new Date('2026-09-09T00:00:00Z')

  // Act + Assert
  expect(tzOffsetMs(instant, 'Asia/Tokyo')).toBe(32_400_000)
  expect(tzOffsetMs(instant, 'America/New_York')).toBe(-14_400_000)
})

test('calendar arithmetic crosses month ends and leap days', () => {
  // Act + Assert
  expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
  expect(daysInMonth('2026-02')).toBe(28)
  expect(daysInMonth('2028-02')).toBe(29)
})

test('impossible dates and unknown zones are rejected', () => {
  // Act + Assert
  expect(isCalendarDay('2026-02-31')).toBe(false)
  expect(isCalendarDay('2026-09-09')).toBe(true)
  expect(isTimeZone('Asia/Tokyo')).toBe(true)
  expect(isTimeZone('Mars/Olympus')).toBe(false)
})

test('a day whose local midnight is skipped by DST starts at the transition instant', () => {
  // Arrange: Chile springs forward at 2026-09-06 00:00 → 01:00, so that midnight never happens
  const zone = 'America/Santiago'

  // Act
  const { start } = dayBounds('2026-09-06', zone)

  // Assert
  expect(new Date(start).toISOString()).toBe('2026-09-06T04:00:00.000Z')
  expect(localDay(new Date(start), zone)).toBe('2026-09-06')
  expect(localDay(new Date(start - 1), zone)).toBe('2026-09-05')
  expect(dayBounds('2026-09-05', zone).end).toBe(start)
})

test('a day before the year 1000 keeps a four-digit year', () => {
  // Act
  const day = localDay(new Date('0999-06-01T12:00:00Z'), 'UTC')

  // Assert
  expect(day).toBe('0999-06-01')
})

test('day math builds one formatter per time zone, however many instants it reads', () => {
  // Arrange: zones no other test here reads, so the cache starts empty for them
  const construct = vi.spyOn(Intl, 'DateTimeFormat')
  const instant = new Date('2026-09-09T00:00:00Z')

  // Act
  const days = [
    localDay(instant, 'Europe/Lisbon'),
    localDay(instant, 'Pacific/Honolulu'),
    localDay(instant, 'Europe/Lisbon'),
    localDay(instant, 'Pacific/Honolulu'),
  ]
  const offset = tzOffsetMs(instant, 'Europe/Lisbon')

  // Assert
  expect(days).toEqual(['2026-09-09', '2026-09-08', '2026-09-09', '2026-09-08'])
  expect(offset).toBe(3_600_000)
  expect(construct).toHaveBeenCalledTimes(2)
})

test('an unknown time zone keeps failing on every read instead of reusing a cached formatter', () => {
  // Arrange
  const instant = new Date('2026-09-09T00:00:00Z')

  // Act
  const readUnknownZone = () => localDay(instant, 'Mars/Olympus_Mons')

  // Assert
  expect(readUnknownZone).toThrow(RangeError)
  expect(readUnknownZone).toThrow(RangeError)
  expect(localDay(instant, 'Asia/Tokyo')).toBe('2026-09-09')
})

test('a client cycling the case of a zone name reuses one formatter instead of growing the cache', () => {
  // Arrange: Intl takes any casing, so each spelling would otherwise be a key of its own
  const construct = vi.spyOn(Intl, 'DateTimeFormat')
  const instant = new Date('2026-09-09T00:00:00Z')

  // Act
  const days = [
    localDay(instant, 'Antarctica/McMurdo'),
    localDay(instant, 'antarctica/mcmurdo'),
    localDay(instant, 'ANTARCTICA/MCMURDO'),
    localDay(instant, 'aNtArCtIcA/mCmUrDo'),
  ]

  // Assert
  expect(days).toEqual(['2026-09-09', '2026-09-09', '2026-09-09', '2026-09-09'])
  expect(construct).toHaveBeenCalledTimes(1)
})

test('an offset zone still reads right but is built per call, never kept in the cache', () => {
  // Arrange: '+05:45', '+0545' and '+05' are thousands of spellings a client could cycle through
  const construct = vi.spyOn(Intl, 'DateTimeFormat')
  const instant = new Date('2026-09-09T00:00:00Z')

  // Act
  const days = [localDay(instant, '-05:45'), localDay(instant, '-05:45')]

  // Assert
  expect(days).toEqual(['2026-09-08', '2026-09-08'])
  expect(construct).toHaveBeenCalledTimes(2)
})

test('an alias zone such as Asia/Kolkata is cached under the name it was given', () => {
  // Arrange: Intl reports Asia/Kolkata as Asia/Calcutta, so a cache keyed by that name would miss every time
  const construct = vi.spyOn(Intl, 'DateTimeFormat')
  const instant = new Date('2026-09-09T00:00:00Z')

  // Act
  const days = [
    localDay(instant, 'Asia/Kolkata'),
    localDay(instant, 'Asia/Kolkata'),
  ]

  // Assert
  expect(days).toEqual(['2026-09-09', '2026-09-09'])
  expect(construct).toHaveBeenCalledTimes(1)
})

import { afterEach, expect, test, vi } from 'vitest'

import {
  fallBackWindows,
  formatDay,
  formatDuration,
  formatElapsed,
  formatMonthDay,
  formatSince,
  formatSpokenDuration,
  formatTime,
  spokenActivityName,
  spokenActivityNames,
  repeatedWallTime,
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

test('the since line builds its formatters once per time zone, however often it renders', () => {
  // Arrange: zones no other test here formats, so the cache starts empty for them. Each zone builds two: the H:MM readout,
  // and the offset reader that finds where its clocks go back.
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
  expect(construct).toHaveBeenCalledTimes(4)
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

test('a screen reader hears durations as 時間 and 分, not the letters h and m', () => {
  // Arrange
  const cases = [
    9 * 3_600_000,
    545 * 60_000,
    22_800_000,
    45 * 60_000,
    29_999,
    30_000,
  ]

  // Act
  const spoken = cases.map(formatSpokenDuration)

  // Assert: the same minute rounding as the visible 9h 00m, 9h 05m, 6h 20m, 45m, 0m, 1m
  expect(spoken).toEqual([
    '9時間',
    '9時間5分',
    '6時間20分',
    '45分',
    '0分',
    '1分',
  ])
})

test('an activity name that could pass for detox, 平均から除外 or a pause between parts is read with 活動 in front', () => {
  // Arrange
  const names = [
    '仕事',
    'detox',
    'Detox の日',
    'ｄｅｔｏｘ',
    '平均から除外',
    '今週は平均から除外',
    '仕事 1時間、detox',
    '活動',
    '活動 仕事',
    '読書・勉強',
  ]

  // Act
  const spoken = names.map(spokenActivityName)

  // Assert: a plain name and a 中黒 inside one (no longer the label's separator) read as written
  expect(spoken).toEqual([
    '仕事',
    '活動 detox',
    '活動 Detox の日',
    '活動 ｄｅｔｏｘ',
    '活動 平均から除外',
    '活動 今週は平均から除外',
    '活動 仕事 1時間、detox',
    '活動 活動',
    '活動 活動 仕事',
    '読書・勉強',
  ])
})

test('an archived activity that shares its name with a live one is read as アーカイブ済み', () => {
  // Arrange
  const activities = [
    { id: 'live', name: '仕事', archivedAt: null },
    { id: 'old', name: '仕事', archivedAt: new Date('2026-09-01T00:00:00Z') },
    { id: 'alone', name: '読書', archivedAt: new Date('2026-09-01T00:00:00Z') },
  ]

  // Act
  const spoken = spokenActivityNames(activities)

  // Assert: an archived activity alone on its name reads as it did while live
  expect([...spoken]).toEqual([
    ['live', '仕事'],
    ['old', '仕事（アーカイブ済み）'],
    ['alone', '読書'],
  ])
})

test('activities whose names are still alike after the archive mark are numbered in list order', () => {
  // Arrange: two live 仕事, two archived 家事, and a live name that copies the archive mark
  const archivedAt = new Date('2026-09-01T00:00:00Z')
  const activities = [
    { id: 'work-1', name: '仕事', archivedAt: null },
    { id: 'work-2', name: '仕事', archivedAt: null },
    { id: 'home-1', name: '家事', archivedAt },
    { id: 'home-2', name: '家事', archivedAt },
    { id: 'fun-copy', name: '娯楽（アーカイブ済み）', archivedAt: null },
    { id: 'fun-old', name: '娯楽', archivedAt },
    { id: 'fun-live', name: '娯楽', archivedAt: null },
  ]

  // Act
  const spoken = spokenActivityNames(activities)

  // Assert
  expect([...spoken]).toEqual([
    ['work-1', '仕事（1）'],
    ['work-2', '仕事（2）'],
    ['home-1', '家事（アーカイブ済み）（1）'],
    ['home-2', '家事（アーカイブ済み）（2）'],
    ['fun-copy', '娯楽（アーカイブ済み）（1）'],
    ['fun-old', '娯楽（アーカイブ済み）（2）'],
    ['fun-live', '娯楽'],
  ])
})

test('a number given to two alike names skips one that another activity is already named, so no two labels read the same', () => {
  // Arrange: two 仕事, and a third activity named 仕事（1） by hand, listed after them
  const activities = [
    { id: 'work-1', name: '仕事', archivedAt: null },
    { id: 'work-2', name: '仕事', archivedAt: null },
    { id: 'work-named-1', name: '仕事（1）', archivedAt: null },
  ]

  // Act
  const spoken = spokenActivityNames(activities)

  // Assert
  expect([...spoken]).toEqual([
    ['work-1', '仕事（2）'],
    ['work-2', '仕事（3）'],
    ['work-named-1', '仕事（1）'],
  ])
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

test('the since line does not date a start the device reads as tomorrow, when its clock is behind the server', () => {
  // Arrange: the server stamped 9/26 0:00:10 JST while the device still reads 9/25
  const justAfterMidnight = new Date('2026-09-25T15:00:10Z')

  // Act
  const label = formatSince(justAfterMidnight, '2026-09-25', 'Asia/Tokyo')

  // Assert
  expect(label).toBe('0:00')
})

test('a date read against a day of the same year leaves the year out, and one from another year writes it', () => {
  // Arrange
  const sameYear = formatMonthDay('2026-09-06', '2026-09-08')
  const lastYear = formatMonthDay('2025-12-28', '2026-01-01')
  const nextYear = formatMonthDay('2027-01-01', '2026-12-31')
  const unread = formatMonthDay('2025-12-28')

  // Assert
  expect(sameYear).toBe('9月6日')
  expect(lastYear).toBe('2025年12月28日')
  expect(nextYear).toBe('2027年1月1日')
  expect(unread).toBe('12月28日')
})

test('the since line writes the year of a record started last year', () => {
  // Arrange: started 2025-12-28 23:00 in Tokyo, read on 2026-01-02.
  const started = new Date('2025-12-28T14:00:00Z')

  // Act
  const label = formatSince(started, '2026-01-02', 'Asia/Tokyo')

  // Assert
  expect(label).toBe('2025年12月28日 23:00')
})

test('on the night New York’s clocks go back, the repeated 1:30 says which of its two occurrences it is', () => {
  // Arrange: 1:30 EDT, 1:30 EST, and 0:30 / 2:30, which occur once.
  const first = new Date('2026-11-01T05:30:00Z')
  const second = new Date('2026-11-01T06:30:00Z')
  const before = new Date('2026-11-01T04:30:00Z')
  const after = new Date('2026-11-01T07:30:00Z')

  // Act
  const labels = [first, second, before, after].map((date) =>
    formatTime(date, 'America/New_York'),
  )

  // Assert
  expect(labels).toEqual(['1:30（1回目）', '1:30（2回目）', '0:30', '2:30'])
})

test('the repeated hour starts at the wall time the clocks go back to and ends where they went back', () => {
  // Arrange: 1:00 EDT is the first repeated minute; 1:00 EST (the change itself) is the second occurrence; 2:00 EST is past.
  const firstStart = new Date('2026-11-01T05:00:00Z')
  const lastFirst = new Date('2026-11-01T05:59:00Z')
  const change = new Date('2026-11-01T06:00:00Z')
  const past = new Date('2026-11-01T07:00:00Z')

  // Act
  const occurrences = [firstStart, lastFirst, change, past].map((date) =>
    repeatedWallTime(date, 'America/New_York'),
  )

  // Assert
  expect(occurrences).toEqual([1, 1, 2, null])
})

test('Lord Howe’s half-hour fall back marks only the half hour it repeats', () => {
  // Arrange: 2:00 +11:00 goes back to 1:30 +10:30 on 2026-04-05 local, so 1:30 – 2:00 occurs twice.
  const first = new Date('2026-04-04T14:45:00Z')
  const second = new Date('2026-04-04T15:15:00Z')
  const onceBefore = new Date('2026-04-04T14:15:00Z')

  // Act
  const labels = [first, second, onceBefore].map((date) =>
    formatTime(date, 'Australia/Lord_Howe'),
  )

  // Assert
  expect(labels).toEqual(['1:45（1回目）', '1:45（2回目）', '1:15'])
})

test('Casablanca’s Ramadan fall back, found by the daily scan, marks its repeated 2 o’clock hour', () => {
  // Arrange: 3:00 +01:00 goes back to 2:00 +00:00 on 2026-02-15.
  const first = new Date('2026-02-15T01:30:00Z')
  const second = new Date('2026-02-15T02:30:00Z')

  // Act
  const labels = [first, second].map((date) =>
    formatTime(date, 'Africa/Casablanca'),
  )
  const windows = fallBackWindows('Africa/Casablanca', 2026)

  // Assert
  expect(labels).toEqual(['2:30（1回目）', '2:30（2回目）'])
  expect(windows[0]).toEqual({
    start: Date.parse('2026-02-15T01:00:00Z'),
    turnBack: Date.parse('2026-02-15T02:00:00Z'),
    end: Date.parse('2026-02-15T03:00:00Z'),
  })
})

test('a zone that never moves its clocks writes every time bare', () => {
  // Arrange
  const instant = new Date('2026-11-01T06:30:00Z')

  // Act
  const label = formatTime(instant, 'Asia/Tokyo')
  const windows = fallBackWindows('Asia/Tokyo', 2026)

  // Assert
  expect(label).toBe('15:30')
  expect(windows).toEqual([])
})

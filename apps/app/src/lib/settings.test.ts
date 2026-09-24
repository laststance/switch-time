import { expect, test } from 'vitest'

import {
  editorRows,
  excludedRange,
  exclusionSummary,
  idleLabel,
  reorderIds,
  SETTINGS_REFETCH_ROUTERS,
  spareColor,
  targetHoursFromText,
  zoneSyncAction,
} from './settings'

test('a fresh install writes its zone once when the account holds another', () => {
  // Arrange
  const zones = {
    stored: 'Asia/Tokyo',
    device: 'Europe/London',
    lastSynced: null,
    settled: true,
  }

  // Act & Assert
  expect(zoneSyncAction(zones)).toBe('write')
})

test('two devices in different zones stop overwriting each other: the one that already synced its zone leaves the other’s write alone', () => {
  // Arrange: this device wrote Tokyo, then a laptop in London wrote London.
  const zones = {
    stored: 'Europe/London',
    device: 'Asia/Tokyo',
    lastSynced: 'Asia/Tokyo',
    settled: true,
  }

  // Act & Assert
  expect(zoneSyncAction(zones)).toBe('none')
})

test('a device that moved to another zone writes its new zone', () => {
  // Arrange
  const zones = {
    stored: 'Asia/Tokyo',
    device: 'America/New_York',
    lastSynced: 'Asia/Tokyo',
    settled: true,
  }

  // Act & Assert
  expect(zoneSyncAction(zones)).toBe('write')
})

test('a fresh install whose zone the account already holds only remembers it, so a later write from another device is not undone', () => {
  // Arrange
  const zones = {
    stored: 'Asia/Tokyo',
    device: 'Asia/Tokyo',
    lastSynced: null,
    settled: true,
  }

  // Act & Assert
  expect(zoneSyncAction(zones)).toBe('record')
})

test('nothing is written or remembered while a settings write is in flight, since the cached zone may be an optimistic one', () => {
  // Arrange: the zone write's optimistic value already reads as the device's.
  const inFlight = {
    stored: 'Asia/Tokyo',
    device: 'Asia/Tokyo',
    lastSynced: null,
    settled: false,
  }
  const differs = { ...inFlight, stored: 'UTC' }

  // Act & Assert
  expect(zoneSyncAction(inFlight)).toBe('none')
  expect(zoneSyncAction(differs)).toBe('none')
})

test('a device already in step with the account does nothing', () => {
  // Arrange
  const zones = {
    stored: 'Asia/Tokyo',
    device: 'Asia/Tokyo',
    lastSynced: 'Asia/Tokyo',
    settled: true,
  }

  // Act & Assert
  expect(zoneSyncAction(zones)).toBe('none')
})

const activity = (
  id: string,
  name: string,
  color: string,
  position: number,
  targetHours: number | null,
  archivedAt: Date | null = null,
) => ({
  id,
  userId: 'u',
  name,
  color,
  iconKey: id,
  targetHours,
  position,
  archivedAt,
  createdAt: new Date(2026, 8, 1),
})

test('the editor lists live activities only and keeps the current state and the last activity from being archived', () => {
  // Arrange: 仕事 is the current state; 読書 was archived.
  const list = [
    activity('home', '家事', '#E0A431', 0, 1.5),
    activity('work', '仕事', '#3B7BD9', 1, 8),
    activity('rest', '休息', '#4FA877', 2, null),
    activity('book', '読書', '#2BA3B5', 3, 1, new Date(2026, 8, 8)),
  ]

  // Act
  const rows = editorRows(list, 'work')

  // Assert
  expect(
    rows.map((row) => [
      row.name,
      row.targetText,
      row.canMoveUp,
      row.canMoveDown,
      row.canArchive,
    ]),
  ).toEqual([
    ['家事', '1.5', false, true, true],
    ['仕事', '8', true, true, false],
    ['休息', '', true, false, true],
  ])
  expect(
    editorRows([activity('home', '家事', '#E0A431', 0, 1.5)], null)[0]
      ?.canArchive,
  ).toBe(false)
  expect(editorRows(undefined, null)).toEqual([])
})

test('a new activity takes the first unused palette colour and wraps when all eight are used', () => {
  // Arrange
  const six = ['#E0A431', '#3B7BD9', '#4FA877', '#6C63D6', '#E0684A', '#D8579C']
  const eight = [...six, '#2BA3B5', '#8A6A4B']

  // Act
  const seventh = spareColor(six)
  const wrapped = spareColor(eight)
  const firstFree = spareColor(['#3B7BD9'])

  // Assert
  expect(seventh).toBe('#2BA3B5')
  expect(wrapped).toBe('#E0A431')
  expect(firstFree).toBe('#E0A431')
})

test('moving an id one step swaps it with its neighbour and stays put at the ends', () => {
  // Arrange
  const ids = ['a', 'b', 'c']

  // Act
  const movedUp = reorderIds(ids, 'c', -1)
  const movedDown = reorderIds(ids, 'a', 1)
  const aboveFirst = reorderIds(ids, 'a', -1)
  const belowLast = reorderIds(ids, 'c', 1)
  const unknownId = reorderIds(ids, 'zzz', 1)

  // Assert
  expect(movedUp).toEqual(['a', 'c', 'b'])
  expect(movedDown).toEqual(['b', 'a', 'c'])
  expect(aboveFirst).toBe(ids)
  expect(belowLast).toBe(ids)
  expect(unknownId).toBe(ids)
})

test('the exclusion row and the idle picker read the stored threshold in hours', () => {
  // Arrange
  const on = { autoExcludeUnusedDays: true, idleThresholdMinutes: 720 }
  const off = { autoExcludeUnusedDays: false, idleThresholdMinutes: 480 }

  // Act
  const whole = idleLabel(720)
  const partial = idleLabel(90)
  const onSummary = exclusionSummary(on, true)
  const offSummary = exclusionSummary(off, true)

  // Assert
  expect(whole).toBe('12時間')
  expect(partial).toBe('90分')
  expect(onSummary).toBe('オン · 無操作 12時間以上')
  expect(offSummary).toBe('オフ')
})

test('the exclusion row summarises nothing until the settings row has been read', () => {
  // Arrange
  const unreadSettings = {
    autoExcludeUnusedDays: true,
    idleThresholdMinutes: 720,
  }

  // Act
  const summary = exclusionSummary(unreadSettings, false)

  // Assert
  expect(summary).toBe('—')
})

test('a blank target field means no target and the excluded-days window is the last year', () => {
  // Arrange
  const day = '2026-09-09'

  // Act
  const blank = targetHoursFromText('  ')
  const parsed = targetHoursFromText('1.5')
  const range = excludedRange(day)

  // Assert
  expect(blank).toBeNull()
  expect(parsed).toBe(1.5)
  expect(range).toEqual({ from: '2025-09-09', to: '2026-09-09' })
})

test('the routers a settings update refetches include the day lists, so a zone change followed by a theme tap still re-windows every day', () => {
  // Arrange: the last update of a batch is the one that refetches, and it may carry no time zone.
  const refetched = SETTINGS_REFETCH_ROUTERS

  // Act & Assert
  expect(refetched).toEqual(['settings', 'stats', 'switches'])
})

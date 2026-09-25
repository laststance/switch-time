import { expect, test } from 'vitest'

import {
  editorRows,
  excludedRange,
  exclusionSummary,
  idleLabel,
  reorderIds,
  rolledBackSettings,
  SETTINGS_REFETCH_ROUTERS,
  spareColor,
  targetHoursFromText,
  zoneRow,
  zoneSyncAction,
} from './settings'

test('a fresh install writes its zone once when the account holds another', () => {
  // Arrange
  const zones = {
    stored: 'Asia/Tokyo',
    device: 'Europe/London',
    lastSynced: null,
    settled: true,
    failedWrite: undefined,
    account: 'user-1',
    rowAccount: 'user-1',
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
    failedWrite: undefined,
    account: 'user-1',
    rowAccount: 'user-1',
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
    failedWrite: undefined,
    account: 'user-1',
    rowAccount: 'user-1',
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
    failedWrite: undefined,
    account: 'user-1',
    rowAccount: 'user-1',
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
    failedWrite: undefined,
    account: 'user-1',
    rowAccount: 'user-1',
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
    failedWrite: undefined,
    account: 'user-1',
    rowAccount: 'user-1',
  }

  // Act & Assert
  expect(zoneSyncAction(zones)).toBe('none')
})

test('right after a switch to another account, the previous account’s cached row is neither remembered nor written as the new account’s zone', () => {
  // Arrange: the cache still holds user-1's row (Tokyo, this device's zone) while the session is already user-2's.
  const previousAccountsRow = {
    stored: 'Asia/Tokyo',
    device: 'Asia/Tokyo',
    lastSynced: null,
    settled: true,
    failedWrite: undefined,
    account: 'user-2',
    rowAccount: 'user-1',
  }
  const previousAccountsOtherZone = {
    ...previousAccountsRow,
    stored: 'UTC',
  }

  // Act & Assert
  expect(zoneSyncAction(previousAccountsRow)).toBe('none')
  expect(zoneSyncAction(previousAccountsOtherZone)).toBe('none')
})

test('the zone sync waits until the settings row says whose it is', () => {
  // Arrange
  const unloadedRow = {
    stored: 'Asia/Tokyo',
    device: 'Europe/London',
    lastSynced: null,
    settled: true,
    failedWrite: undefined,
    account: 'user-1',
    rowAccount: undefined,
  }
  const signedOut = { ...unloadedRow, account: undefined }

  // Act & Assert
  expect(zoneSyncAction(unloadedRow)).toBe('none')
  expect(zoneSyncAction(signedOut)).toBe('none')
})

test('設定’s タイムゾーン row shows a dash and no button until the settings row is read', () => {
  // Act
  const row = zoneRow({
    stored: 'Asia/Tokyo',
    device: 'Europe/London',
    ready: false,
    failedWrite: undefined,
    account: 'user-1',
    rowAccount: 'user-1',
  })

  // Assert
  expect(row).toEqual({ summary: '—', alert: false, canTakeBack: false })
})

test('設定’s タイムゾーン row does not claim the default zone matches this device, nor show a stale failure, before the settings row is read', () => {
  // Arrange: the unread row sits on SETTINGS_DEFAULTS' Asia/Tokyo, which is also this device's zone.
  const unreadOnDefaults = {
    stored: 'Asia/Tokyo',
    device: 'Asia/Tokyo',
    ready: false,
    failedWrite: undefined,
    account: 'user-1',
    rowAccount: 'user-1',
  }
  const unreadAfterFailure = {
    stored: 'America/New_York',
    device: 'Asia/Tokyo',
    ready: false,
    failedWrite: { forUserId: 'user-1', timeZone: 'Asia/Tokyo' },
    account: 'user-1',
    rowAccount: 'user-1',
  }

  // Act
  const defaultsRow = zoneRow(unreadOnDefaults)
  const failureRow = zoneRow(unreadAfterFailure)

  // Assert
  expect(defaultsRow).toEqual({
    summary: '—',
    alert: false,
    canTakeBack: false,
  })
  expect(failureRow).toEqual({
    summary: '—',
    alert: false,
    canTakeBack: false,
  })
})

test('設定’s タイムゾーン row says the account already uses this device’s zone and offers no button', () => {
  // Act
  const row = zoneRow({
    stored: 'Asia/Tokyo',
    device: 'Asia/Tokyo',
    ready: true,
    failedWrite: undefined,
    account: 'user-1',
    rowAccount: 'user-1',
  })

  // Assert
  expect(row).toEqual({
    summary: 'Asia/Tokyo · この端末と同じ',
    alert: false,
    canTakeBack: false,
  })
})

test('設定’s タイムゾーン row names both zones and offers この端末に合わせる when another device set the account’s zone', () => {
  // Act
  const row = zoneRow({
    stored: 'America/New_York',
    device: 'Asia/Tokyo',
    ready: true,
    failedWrite: undefined,
    account: 'user-1',
    rowAccount: 'user-1',
  })

  // Assert
  expect(row).toEqual({
    summary: 'America/New_York · この端末は Asia/Tokyo',
    alert: false,
    canTakeBack: true,
  })
})

test('a failed take-back says so and keeps the button for another try', () => {
  // Act
  const row = zoneRow({
    stored: 'America/New_York',
    device: 'Asia/Tokyo',
    ready: true,
    failedWrite: { forUserId: 'user-1', timeZone: 'Asia/Tokyo' },
    account: 'user-1',
    rowAccount: 'user-1',
  })

  // Assert
  expect(row).toEqual({
    summary: '保存できませんでした。もう一度お試しください',
    alert: true,
    canTakeBack: true,
  })
})

test('a failure line goes away once a later read shows the account already on this device’s zone', () => {
  // Act
  const row = zoneRow({
    stored: 'Asia/Tokyo',
    device: 'Asia/Tokyo',
    ready: true,
    failedWrite: { forUserId: 'user-1', timeZone: 'Asia/Tokyo' },
    account: 'user-1',
    rowAccount: 'user-1',
  })

  // Assert
  expect(row).toEqual({
    summary: 'Asia/Tokyo · この端末と同じ',
    alert: false,
    canTakeBack: false,
  })
})

test('a zone write that failed is not sent again for the same account and zone, so a rollback does not start it over', () => {
  // Arrange: the write of Europe/London for user-1 failed, and the rollback put Asia/Tokyo back.
  const zones = {
    stored: 'Asia/Tokyo',
    device: 'Europe/London',
    lastSynced: 'Asia/Tokyo',
    settled: true,
    failedWrite: { forUserId: 'user-1', timeZone: 'Europe/London' },
    account: 'user-1',
    rowAccount: 'user-1',
  }

  // Act & Assert
  expect(zoneSyncAction(zones)).toBe('none')
})

test('a failed zone write does not stop the next account, nor the same account once the device has moved on', () => {
  // Arrange: user-1's write of Europe/London failed.
  const nextAccount = {
    stored: 'Asia/Tokyo',
    device: 'Europe/London',
    lastSynced: null,
    settled: true,
    failedWrite: { forUserId: 'user-1', timeZone: 'Europe/London' },
    account: 'user-2',
    rowAccount: 'user-2',
  }
  const movedOn = {
    stored: 'Asia/Tokyo',
    device: 'America/New_York',
    lastSynced: 'Asia/Tokyo',
    settled: true,
    failedWrite: { forUserId: 'user-1', timeZone: 'Europe/London' },
    account: 'user-1',
    rowAccount: 'user-1',
  }

  // Act & Assert
  expect(zoneSyncAction(nextAccount)).toBe('write')
  expect(zoneSyncAction(movedOn)).toBe('write')
})

test('設定’s タイムゾーン row shows a dash, not the previous account’s zone, right after a switch to another account', () => {
  // Act: the cache still holds user-1's row (Tokyo, this device's zone) while the session is already user-2's.
  const row = zoneRow({
    stored: 'Asia/Tokyo',
    device: 'Asia/Tokyo',
    ready: true,
    failedWrite: undefined,
    account: 'user-2',
    rowAccount: 'user-1',
  })

  // Assert
  expect(row).toEqual({ summary: '—', alert: false, canTakeBack: false })
})

test('a take-back that failed for the previous account shows no failure line on the next account’s row', () => {
  // Act
  const row = zoneRow({
    stored: 'UTC',
    device: 'Asia/Tokyo',
    ready: true,
    failedWrite: { forUserId: 'user-1', timeZone: 'Asia/Tokyo' },
    account: 'user-2',
    rowAccount: 'user-2',
  })

  // Assert
  expect(row).toEqual({
    summary: 'UTC · この端末は Asia/Tokyo',
    alert: false,
    canTakeBack: true,
  })
})

test('a failed settings write puts the account’s previous row back', () => {
  // Arrange
  const optimistic = { userId: 'user-1', timeZone: 'Asia/Tokyo' }
  const previous = { userId: 'user-1', timeZone: 'UTC' }

  // Act & Assert
  expect(rolledBackSettings(optimistic, previous)).toEqual({
    userId: 'user-1',
    timeZone: 'UTC',
  })
})

test('a failed settings write that lands after a switch to another account leaves the new account’s row alone', () => {
  // Arrange: user-1's write was out when user-2 signed in and user-2's row was read; then the cache was cleared on sign-in.
  const nextAccountsRow = { userId: 'user-2', timeZone: 'America/New_York' }
  const previous = { userId: 'user-1', timeZone: 'UTC' }

  // Act & Assert
  expect(rolledBackSettings(nextAccountsRow, previous)).toEqual({
    userId: 'user-2',
    timeZone: 'America/New_York',
  })
  expect(rolledBackSettings(undefined, previous)).toBeUndefined()
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

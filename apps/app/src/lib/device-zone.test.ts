import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { deviceZone, readSyncedZone, rememberSyncedZone } from './device-zone'

// Node cannot load react-native or the native keychain: the platform is switchable per test, SecureStore records its calls.
const platform = vi.hoisted(() => ({ OS: 'web' }))
const secureStore = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => string | null>(),
  setItem: vi.fn<(key: string, value: string) => void>(),
}))
vi.mock('react-native', () => ({ Platform: platform }))
vi.mock('expo-secure-store', () => secureStore)

// A browser's localStorage, backed by a Map so each test starts empty.
function memoryStorage() {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem: (key: string): string | null => entries.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      entries.set(key, value)
    },
  }
}

beforeEach(() => {
  platform.OS = 'web'
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  secureStore.getItem.mockReset()
  secureStore.setItem.mockReset()
})

test('a zone a browser synced for one account is read back for that account only, so a second account still gets its zone written', () => {
  // Arrange
  vi.stubGlobal('localStorage', memoryStorage())
  rememberSyncedZone('account-1', 'Asia/Tokyo')

  // Act
  const firstAccountZone = readSyncedZone('account-1')
  const secondAccountZone = readSyncedZone('account-2')

  // Assert
  expect(firstAccountZone).toBe('Asia/Tokyo')
  expect(secondAccountZone).toBeNull()
})

test('on native the synced zone is kept in SecureStore under a key it accepts, even for an account id with other characters', () => {
  // Arrange
  platform.OS = 'ios'
  secureStore.getItem.mockReturnValue('Europe/London')

  // Act
  rememberSyncedZone('user:42/@x', 'Europe/London')
  const zone = readSyncedZone('user:42/@x')

  // Assert
  expect(secureStore.setItem).toHaveBeenCalledWith(
    'switch-time.synced-zone.user_42__x',
    'Europe/London',
  )
  expect(secureStore.getItem).toHaveBeenCalledWith(
    'switch-time.synced-zone.user_42__x',
  )
  expect(zone).toBe('Europe/London')
})

test('a browser whose storage refuses access still remembers the zone it synced for the rest of the session, instead of crashing the app', () => {
  // Arrange: a private window, where every storage call throws
  vi.stubGlobal('localStorage', {
    getItem: (): string | null => {
      throw new Error('SecurityError')
    },
    setItem: (): void => {
      throw new Error('SecurityError')
    },
  })

  // Act
  const neverSyncedZone = readSyncedZone('private-window-account')
  const remember = (): void =>
    rememberSyncedZone('private-window-account', 'Asia/Tokyo')
  const syncedZone = (): string | null =>
    readSyncedZone('private-window-account')

  // Assert
  expect(neverSyncedZone).toBeNull()
  expect(remember).not.toThrow()
  expect(syncedZone()).toBe('Asia/Tokyo')
})

test('a device that moves to another zone while the app stays open reports its new zone, not the one it had at launch', () => {
  // Arrange: the device starts in Tokyo.
  const tokyo = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
  }).resolvedOptions()
  const london = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/London',
  }).resolvedOptions()
  const resolvedOptions = vi
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockReturnValue(tokyo)
  const zoneAtLaunch = deviceZone()

  // Act: the device lands in London.
  resolvedOptions.mockReturnValue(london)
  const zoneAfterMove = deviceZone()

  // Assert
  expect(zoneAtLaunch).toBe('Asia/Tokyo')
  expect(zoneAfterMove).toBe('Europe/London')
})

test('while signed out no zone is read or kept, so the next account to sign in starts unsynced', () => {
  // Arrange
  const storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)

  // Act
  rememberSyncedZone(undefined, 'Asia/Tokyo')
  const zone = readSyncedZone(undefined)

  // Assert
  expect(zone).toBeNull()
  expect(storage.entries.size).toBe(0)
})

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { readSyncedZone, rememberSyncedZone } from './device-zone'

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

test('a browser whose storage refuses access reads as never synced and keeps nothing, instead of crashing the app', () => {
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
  const remember = (): void => rememberSyncedZone('account-1', 'Asia/Tokyo')
  const zone = readSyncedZone('account-1')

  // Assert
  expect(remember).not.toThrow()
  expect(zone).toBeNull()
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

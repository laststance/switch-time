import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { selectSyncedZone, zoneSynced } from './synced-zone'

import { createAppStore } from './index'

// Node cannot load the native keychain: SecureStore is a Map that records its calls.
const keychain = vi.hoisted(() => new Map<string, string>())
const secureStore = vi.hoisted(() => ({
  getItem: vi.fn((key: string): string | null => keychain.get(key) ?? null),
  setItem: vi.fn((key: string, value: string): void => {
    keychain.set(key, value)
  }),
  deleteItemAsync: vi.fn(async (key: string): Promise<void> => {
    keychain.delete(key)
  }),
}))
vi.mock('expo-secure-store', () => secureStore)

// The native storage remembers what it last wrote: each test loads a fresh copy, as a fresh launch does.
const loadDeviceStorage = async () => {
  vi.resetModules()
  const { deviceStorage } = await import('./device-storage.native')
  return deviceStorage
}

// The storage middleware reads back on a microtask and saves 300 ms after the last action: running every timer settles both.
const settle = async (): Promise<void> => {
  await vi.runAllTimersAsync()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  keychain.clear()
  secureStore.getItem.mockClear()
  secureStore.setItem.mockClear()
  secureStore.deleteItemAsync.mockClear()
})

test('on iOS and Android a synced zone is kept in SecureStore under a key it accepts, and is known again after a relaunch', async () => {
  // Arrange
  const firstLaunch = createAppStore(await loadDeviceStorage())
  await settle()
  firstLaunch.dispatch(
    zoneSynced({ accountId: 'user:42/@x', zone: 'Europe/London' }),
  )
  await settle()

  // Act
  const secondLaunch = createAppStore(await loadDeviceStorage())
  await settle()

  // Assert
  expect(secureStore.setItem).toHaveBeenCalledWith(
    'switch-time.device',
    '{"version":0,"state":{"syncedZone":{"byAccount":{"user:42/@x":"Europe/London"}}}}',
  )
  expect(secureStore.getItem).toHaveBeenCalledWith('switch-time.device')
  expect(selectSyncedZone(secondLaunch.getState(), 'user:42/@x')).toBe(
    'Europe/London',
  )
})

test('on iOS and Android clearing the device storage deletes the SecureStore entry, and the delete can be awaited', async () => {
  // Arrange
  keychain.set(
    'switch-time.device',
    '{"version":0,"state":{"syncedZone":{"byAccount":{"account-1":"Asia/Tokyo"}}}}',
  )
  const deviceStorage = await loadDeviceStorage()

  // Act
  const removed: unknown = deviceStorage.removeItem('switch-time.device')

  // Assert
  await expect(removed).resolves.toBeUndefined()
  expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('switch-time.device')
  expect(keychain.has('switch-time.device')).toBe(false)
})

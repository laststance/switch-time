import { createMemoryStorage } from '@laststance/redux-storage-middleware'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { clockSlice } from './clock'
import { skipUnchangedWrites } from './skip-unchanged-writes'
import { selectSyncedZone, zoneSynced } from './synced-zone'

import { createAppStore, resetApp } from './index'

// The storage middleware reads back on a microtask and saves 300 ms after the last action: running every timer settles both.
const settle = async (): Promise<void> => {
  await vi.runAllTimersAsync()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('a zone this device synced is still known after a relaunch, so the device does not write its zone to the account again', async () => {
  // Arrange
  const storage = createMemoryStorage()
  const firstLaunch = createAppStore(storage)
  await settle()
  firstLaunch.dispatch(
    zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }),
  )
  await settle()

  // Act
  const secondLaunch = createAppStore(storage)
  await settle()

  // Assert
  expect(selectSyncedZone(secondLaunch.getState(), 'account-1')).toBe(
    'Asia/Tokyo',
  )
  expect(storage.getItem('switch-time.device')).toBe(
    '{"version":0,"state":{"syncedZone":{"byAccount":{"account-1":"Asia/Tokyo"}}}}',
  )
})

test('only the synced zones are kept on the device, so a relaunch never restores the previous session’s registration or undo', async () => {
  // Arrange
  const storage = createMemoryStorage()
  const store = createAppStore(storage)
  await settle()

  // Act
  store.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()

  // Assert
  expect(storage.getItem('switch-time.device')).not.toContain('registration')
  expect(storage.getItem('switch-time.device')).not.toContain('correction')
})

test('signing out keeps the zones this device synced, so signing back in does not rewrite the account’s zone', async () => {
  // Arrange
  const storage = createMemoryStorage()
  const store = createAppStore(storage)
  await settle()
  store.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))

  // Act
  store.dispatch(resetApp())
  await settle()
  const relaunched = createAppStore(storage)
  await settle()

  // Assert
  expect(selectSyncedZone(store.getState(), 'account-1')).toBe('Asia/Tokyo')
  expect(selectSyncedZone(relaunched.getState(), 'account-1')).toBe(
    'Asia/Tokyo',
  )
})

test('the clock ticking every second does not rewrite device storage when no synced zone changed', async () => {
  // Arrange
  const memory = createMemoryStorage()
  const setItem = vi.spyOn(memory, 'setItem')
  const store = createAppStore(skipUnchangedWrites(memory))
  await settle()
  store.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()

  // Act
  for (let second = 1; second <= 5; second += 1) {
    store.dispatch(clockSlice.actions.tick(second * 1000))
    await settle()
  }

  // Assert
  expect(setItem).toHaveBeenCalledTimes(1)
})

test('a broken value left under the store’s key does not crash the app at launch: every account syncs its zone once more', async () => {
  // Arrange: a hand-edited or foreign value where the synced zones belong
  const storage = createMemoryStorage()
  storage.setItem(
    'switch-time.device',
    '{"version":0,"state":{"syncedZone":null}}',
  )

  // Act
  const store = createAppStore(storage)
  await settle()

  // Assert
  expect(store.getState().syncedZone).toEqual({ byAccount: {} })
  expect(selectSyncedZone(store.getState(), 'account-1')).toBeNull()
})

test('a device whose storage refuses access still remembers the zone it synced for the rest of the session, instead of crashing the app', async () => {
  // Arrange: a locked keychain, where every storage call throws
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const refusing = {
    getItem: (): string | null => {
      throw new Error('keychain locked')
    },
    setItem: (): void => {
      throw new Error('keychain locked')
    },
    removeItem: (): void => {
      throw new Error('keychain locked')
    },
  }
  const store = createAppStore(skipUnchangedWrites(refusing))
  await settle()

  // Act
  store.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()

  // Assert
  expect(selectSyncedZone(store.getState(), 'account-1')).toBe('Asia/Tokyo')
})

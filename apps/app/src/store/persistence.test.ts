import { createMemoryStorage } from '@laststance/redux-storage-middleware'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { clockSlice } from './clock'
import { skipUnchangedWrites } from './skip-unchanged-writes'
import { selectSyncedZone, syncedZonesReread, zoneSynced } from './synced-zone'

import { createAppStore, resetApp, savedSyncedZones } from './index'

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

test('synced zones saved by a build with another storage version are dropped at launch, and the next sync is kept on the device again', async () => {
  // Arrange: a value written under a version this build does not read
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const storage = createMemoryStorage()
  storage.setItem(
    'switch-time.device',
    '{"version":3,"state":{"syncedZone":{"byAccount":{"account-1":"Europe/London"}}}}',
  )
  const store = createAppStore(storage)
  await settle()

  // Act
  store.dispatch(zoneSynced({ accountId: 'account-2', zone: 'Asia/Tokyo' }))
  await settle()

  // Assert
  expect(selectSyncedZone(store.getState(), 'account-1')).toBeNull()
  expect(storage.getItem('switch-time.device')).toBe(
    '{"version":0,"state":{"syncedZone":{"byAccount":{"account-2":"Asia/Tokyo"}}}}',
  )
})

test('a saved value whose zones are not text is not trusted at launch, and the next sync replaces it on the device', async () => {
  // Arrange
  const storage = createMemoryStorage()
  storage.setItem(
    'switch-time.device',
    '{"version":0,"state":{"syncedZone":{"byAccount":{"account-1":1}}}}',
  )
  const store = createAppStore(storage)
  await settle()

  // Act
  store.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()

  // Assert
  expect(storage.getItem('switch-time.device')).toBe(
    '{"version":0,"state":{"syncedZone":{"byAccount":{"account-1":"Asia/Tokyo"}}}}',
  )
})

test('a saved value without the synced zones starts every account unsynced, and the next sync is kept on the device', async () => {
  // Arrange
  const storage = createMemoryStorage()
  storage.setItem('switch-time.device', '{"version":0,"state":{}}')
  const store = createAppStore(storage)
  await settle()

  // Act
  store.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()

  // Assert
  expect(storage.getItem('switch-time.device')).toBe(
    '{"version":0,"state":{"syncedZone":{"byAccount":{"account-1":"Asia/Tokyo"}}}}',
  )
})

test('zones synced for several accounts on one device are all known after a relaunch', async () => {
  // Arrange
  const storage = createMemoryStorage()
  const firstLaunch = createAppStore(storage)
  await settle()
  firstLaunch.dispatch(
    zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }),
  )
  firstLaunch.dispatch(
    zoneSynced({ accountId: 'account-2', zone: 'Europe/London' }),
  )
  await settle()

  // Act
  const secondLaunch = createAppStore(storage)
  await settle()

  // Assert
  expect(selectSyncedZone(secondLaunch.getState(), 'account-1')).toBe(
    'Asia/Tokyo',
  )
  expect(selectSyncedZone(secondLaunch.getState(), 'account-2')).toBe(
    'Europe/London',
  )
})

test.each([
  ['text that is not JSON', 'not json'],
  ['JSON with no saved state', '{"foo":1}'],
])(
  'a value under the store’s key that is %s is replaced by the next sync, so the device stops syncing its zone on every launch',
  async (_kind, broken) => {
    // Arrange
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = createMemoryStorage()
    storage.setItem('switch-time.device', broken)
    const store = createAppStore(storage)
    await settle()

    // Act
    store.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
    await settle()

    // Assert
    expect(storage.getItem('switch-time.device')).toBe(
      '{"version":0,"state":{"syncedZone":{"byAccount":{"account-1":"Asia/Tokyo"}}}}',
    )
  },
)

test('a device whose storage refuses the read at launch keeps what it holds, instead of losing it to that session’s saves', async () => {
  // Arrange: a keychain locked for the launch's read only
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const storage = createMemoryStorage()
  storage.setItem(
    'switch-time.device',
    '{"version":0,"state":{"syncedZone":{"byAccount":{"account-1":"Asia/Tokyo"}}}}',
  )
  vi.spyOn(storage, 'getItem').mockImplementationOnce(() => {
    throw new Error('keychain locked')
  })
  const store = createAppStore(storage)
  await settle()

  // Act
  store.dispatch(zoneSynced({ accountId: 'account-2', zone: 'Europe/London' }))
  await settle()

  // Assert
  expect(storage.getItem('switch-time.device')).toBe(
    '{"version":0,"state":{"syncedZone":{"byAccount":{"account-1":"Asia/Tokyo"}}}}',
  )
})

test('a zone synced before the launch’s read lands is kept over the older zone the device held for that account', async () => {
  // Arrange
  const storage = createMemoryStorage()
  storage.setItem(
    'switch-time.device',
    '{"version":0,"state":{"syncedZone":{"byAccount":{"account-1":"UTC"}}}}',
  )
  const store = createAppStore(storage)

  // Act: the sync lands before the store reads the device back
  store.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()

  // Assert
  expect(selectSyncedZone(store.getState(), 'account-1')).toBe('Asia/Tokyo')
})

test('a web tab brought back to the foreground learns the zone another tab synced meanwhile, and its next save keeps both', async () => {
  // Arrange: two tabs of one browser share its storage; the other tab syncs account-2 while this one is hidden
  const storage = createMemoryStorage()
  const thisTab = createAppStore(storage)
  const otherTab = createAppStore(storage)
  await settle()
  otherTab.dispatch(
    zoneSynced({ accountId: 'account-2', zone: 'Europe/London' }),
  )
  await settle()

  // Act: this tab comes back, re-reads, then syncs account-1 itself
  thisTab.dispatch(syncedZonesReread(savedSyncedZones(storage)))
  thisTab.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()

  // Assert
  expect(selectSyncedZone(thisTab.getState(), 'account-2')).toBe(
    'Europe/London',
  )
  expect(storage.getItem('switch-time.device')).toBe(
    '{"version":0,"state":{"syncedZone":{"byAccount":{"account-2":"Europe/London","account-1":"Asia/Tokyo"}}}}',
  )
})

test('a zone another tab synced since replaces this tab’s older copy for that account, and an account only this tab synced stays', async () => {
  // Arrange: both tabs knew account-1 in Tokyo; the other tab then moved it to London; only this tab knows account-3
  const storage = createMemoryStorage()
  const thisTab = createAppStore(storage)
  const otherTab = createAppStore(storage)
  await settle()
  thisTab.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  thisTab.dispatch(
    zoneSynced({ accountId: 'account-3', zone: 'America/New_York' }),
  )
  otherTab.dispatch(
    zoneSynced({ accountId: 'account-1', zone: 'Europe/London' }),
  )
  await settle()

  // Act
  thisTab.dispatch(syncedZonesReread(savedSyncedZones(storage)))

  // Assert
  expect(selectSyncedZone(thisTab.getState(), 'account-1')).toBe(
    'Europe/London',
  )
  expect(selectSyncedZone(thisTab.getState(), 'account-3')).toBe(
    'America/New_York',
  )
})

test('a re-read of a broken value, another build’s save or a storage that throws leaves the tab’s own synced zones as they are', async () => {
  // Arrange
  const storage = createMemoryStorage()
  const store = createAppStore(storage)
  await settle()
  store.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()
  const throwing = {
    getItem: (): never => {
      throw new Error('keychain locked')
    },
    setItem: (): void => {},
    removeItem: (): void => {},
  }

  // Act
  storage.setItem('switch-time.device', 'not json')
  store.dispatch(syncedZonesReread(savedSyncedZones(storage)))
  storage.setItem(
    'switch-time.device',
    '{"version":1,"state":{"syncedZone":{"byAccount":{"account-1":"UTC"}}}}',
  )
  store.dispatch(syncedZonesReread(savedSyncedZones(storage)))
  store.dispatch(syncedZonesReread(savedSyncedZones(throwing)))

  // Assert
  expect(selectSyncedZone(store.getState(), 'account-1')).toBe('Asia/Tokyo')
})

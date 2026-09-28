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

test('a storage that keeps refusing reads is asked again only once, so a locked keychain does not spin', async () => {
  // Arrange
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const memory = createMemoryStorage()
  const getItem = vi.spyOn(memory, 'getItem').mockImplementation(() => {
    throw new Error('keychain locked')
  })

  // Act
  createAppStore(memory)
  await settle()

  // Assert
  expect(getItem).toHaveBeenCalledTimes(2)
})

test('a zone another tab synced is known in this tab as soon as that tab saves it, so this tab does not write its stale zone over it', async () => {
  // Arrange: two tabs of the web app sharing one localStorage
  const storage = createMemoryStorage()
  const tabs = new EventTarget()
  const thisTab = createAppStore(storage, tabs)
  const otherTab = createAppStore(storage)
  await settle()
  otherTab.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()

  // Act: the browser tells this tab that the other tab wrote the key
  tabs.dispatchEvent(
    Object.assign(new Event('storage'), { key: 'switch-time.device' }),
  )
  await settle()

  // Assert
  expect(selectSyncedZone(thisTab.getState(), 'account-1')).toBe('Asia/Tokyo')
})

test('reading another tab’s save keeps the accounts only this tab synced, so neither tab’s next save drops the other’s', async () => {
  // Arrange
  const storage = createMemoryStorage()
  const tabs = new EventTarget()
  const thisTab = createAppStore(storage, tabs)
  const otherTab = createAppStore(storage)
  await settle()
  thisTab.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()
  otherTab.dispatch(
    zoneSynced({ accountId: 'account-2', zone: 'Europe/London' }),
  )
  await settle()

  // Act
  tabs.dispatchEvent(
    Object.assign(new Event('storage'), { key: 'switch-time.device' }),
  )
  await settle()

  // Assert
  expect(thisTab.getState().syncedZone).toEqual({
    byAccount: { 'account-1': 'Asia/Tokyo', 'account-2': 'Europe/London' },
  })
})

test('a save another tab makes under another key is not read back', async () => {
  // Arrange
  const storage = createMemoryStorage()
  const tabs = new EventTarget()
  const getItem = vi.spyOn(storage, 'getItem')
  createAppStore(storage, tabs)
  await settle()

  // Act
  tabs.dispatchEvent(
    Object.assign(new Event('storage'), { key: 'better-auth.session' }),
  )
  await settle()

  // Assert
  expect(getItem).toHaveBeenCalledTimes(1)
})

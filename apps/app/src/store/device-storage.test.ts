import { createMemoryStorage } from '@laststance/redux-storage-middleware'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { selectSyncedZone, zoneSynced } from './synced-zone'

import { createAppStore } from './index'

// The web storage checks for `window.localStorage` once, when it is built: each test builds a fresh one, as a page load does.
const loadDeviceStorage = async () => {
  vi.resetModules()
  const { deviceStorage } = await import('./device-storage')
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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('in a browser a synced zone is kept in localStorage and is known again after a reload', async () => {
  // Arrange
  const localStorage = createMemoryStorage()
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage }))
  const firstLoad = createAppStore(await loadDeviceStorage())
  await settle()
  firstLoad.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()

  // Act
  const secondLoad = createAppStore(await loadDeviceStorage())
  await settle()

  // Assert
  expect(localStorage.getItem('switch-time.device')).toBe(
    '{"version":0,"state":{"syncedZone":{"byAccount":{"account-1":"Asia/Tokyo"}}}}',
  )
  expect(selectSyncedZone(secondLoad.getState(), 'account-1')).toBe(
    'Asia/Tokyo',
  )
})

test('a browser that refuses localStorage (a private window) still remembers the zone it synced for the rest of the session', async () => {
  // Arrange: every localStorage call throws, as Safari's private windows once did
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const refusing = (): never => {
    throw new Error('SecurityError')
  }
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      localStorage: {
        getItem: refusing,
        setItem: refusing,
        removeItem: refusing,
      },
    }),
  )
  const store = createAppStore(await loadDeviceStorage())
  await settle()

  // Act
  store.dispatch(zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }))
  await settle()

  // Assert
  expect(selectSyncedZone(store.getState(), 'account-1')).toBe('Asia/Tokyo')
})

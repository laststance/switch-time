import { createMemoryStorage } from '@laststance/redux-storage-middleware'
import { afterEach, expect, test, vi } from 'vitest'

import { skipUnchangedWrites } from './skip-unchanged-writes'

afterEach(() => {
  vi.restoreAllMocks()
})

test('saving the same synced zones twice writes the device storage once', () => {
  // Arrange
  const memory = createMemoryStorage()
  const setItem = vi.spyOn(memory, 'setItem')
  const storage = skipUnchangedWrites(memory)

  // Act
  storage.setItem('switch-time.device', '{"a":"Asia/Tokyo"}')
  storage.setItem('switch-time.device', '{"a":"Asia/Tokyo"}')

  // Assert
  expect(setItem).toHaveBeenCalledTimes(1)
  expect(memory.getItem('switch-time.device')).toBe('{"a":"Asia/Tokyo"}')
})

test('a save that matches what the device read back at launch is not written again', () => {
  // Arrange
  const memory = createMemoryStorage()
  memory.setItem('switch-time.device', '{"a":"Asia/Tokyo"}')
  const setItem = vi.spyOn(memory, 'setItem')
  const storage = skipUnchangedWrites(memory)
  storage.getItem('switch-time.device')

  // Act
  storage.setItem('switch-time.device', '{"a":"Asia/Tokyo"}')

  // Assert
  expect(setItem).not.toHaveBeenCalled()
})

test('a changed zone is written even after an unchanged save was skipped', () => {
  // Arrange
  const memory = createMemoryStorage()
  const storage = skipUnchangedWrites(memory)
  storage.setItem('switch-time.device', '{"a":"Asia/Tokyo"}')
  storage.setItem('switch-time.device', '{"a":"Asia/Tokyo"}')

  // Act
  storage.setItem('switch-time.device', '{"a":"Europe/London"}')

  // Assert
  expect(memory.getItem('switch-time.device')).toBe('{"a":"Europe/London"}')
})

test('a write the device refused is tried again on the next save, so the zone lands once storage works again', () => {
  // Arrange: the keychain is locked for the first write only
  const memory = createMemoryStorage()
  const setItem = vi.spyOn(memory, 'setItem').mockImplementationOnce(() => {
    throw new Error('keychain locked')
  })
  const storage = skipUnchangedWrites(memory)
  const refusedWrite = (): void =>
    storage.setItem('switch-time.device', '{"a":"Asia/Tokyo"}')

  // Act
  expect(refusedWrite).toThrow('keychain locked')
  storage.setItem('switch-time.device', '{"a":"Asia/Tokyo"}')

  // Assert
  expect(setItem).toHaveBeenCalledTimes(2)
  expect(memory.getItem('switch-time.device')).toBe('{"a":"Asia/Tokyo"}')
})

test('after the device storage is cleared, saving the zones it held before writes them again', () => {
  // Arrange
  const memory = createMemoryStorage()
  const storage = skipUnchangedWrites(memory)
  storage.setItem('switch-time.device', '{"a":"Asia/Tokyo"}')
  storage.removeItem('switch-time.device')

  // Act
  storage.setItem('switch-time.device', '{"a":"Asia/Tokyo"}')

  // Assert
  expect(memory.getItem('switch-time.device')).toBe('{"a":"Asia/Tokyo"}')
})

test('clearing hands back the storage’s own pending delete, so a delete that runs later can still be awaited', async () => {
  // Arrange: a delete that settles asynchronously, as SecureStore's does
  const pendingDelete = Promise.resolve()
  const storage = skipUnchangedWrites({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: async () => pendingDelete,
  })

  // Act
  const removed: unknown = storage.removeItem('switch-time.device')

  // Assert
  expect(removed).toBeInstanceOf(Promise)
  await expect(removed).resolves.toBeUndefined()
})

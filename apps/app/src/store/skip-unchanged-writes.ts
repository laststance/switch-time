import type { SyncStorage } from '@laststance/redux-storage-middleware'

/**
 * Wraps the store's device storage so a write that would store the same text again is skipped. The storage middleware saves
 * after every action, and {@link startClock} dispatches one each second: without this, the web would rewrite `localStorage`
 * and native the keychain every second for nothing. Applied by {@link deviceStorage} on both platforms.
 * @param storage - The platform's storage; a write that throws (SecureStore) is not remembered, so the next save tries again.
 *   The web's safe `localStorage` logs a failed write instead of throwing, so that write counts as done for the session.
 * @returns The same storage, minus the writes that change nothing.
 * @example skipUnchangedWrites(createSafeLocalStorage())
 */
export function skipUnchangedWrites(storage: SyncStorage): SyncStorage {
  // What storage holds per key, as far as this session knows: the last read or the last write that went through.
  const known = new Map<string, string | null>()
  return {
    getItem: (key) => {
      const value = storage.getItem(key)
      known.set(key, value)
      return value
    },
    setItem: (key, value): void => {
      if (known.get(key) === value) return
      storage.setItem(key, value)
      known.set(key, value)
    },
    // Hands back what the storage returns, so the middleware can await a delete that runs asynchronously (SecureStore).
    removeItem: (key): void => {
      const removed = storage.removeItem(key)
      known.set(key, null)
      return removed
    },
  }
}

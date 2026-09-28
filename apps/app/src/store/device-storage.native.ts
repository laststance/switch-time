import * as SecureStore from 'expo-secure-store'

import { skipUnchangedWrites } from './skip-unchanged-writes'

/**
 * Where {@link store} persists its device slices on iOS and Android: SecureStore's synchronous calls, so the store hydrates
 * before the first settings fetch settles. A read or write that throws (a locked keychain) is logged by the storage
 * middleware, and the store's copy still holds for the session. The web build loads `device-storage.ts` instead.
 * @example createStorageMiddleware({ storage: deviceStorage, ... })
 */
export const deviceStorage = skipUnchangedWrites({
  getItem: (key) => SecureStore.getItem(key),
  setItem: (key, value) => SecureStore.setItem(key, value),
  // SecureStore deletes only asynchronously: the middleware awaits a returned promise and logs a failed delete.
  removeItem: async (key) => SecureStore.deleteItemAsync(key),
})

import { createSafeLocalStorage } from '@laststance/redux-storage-middleware'

import { skipUnchangedWrites } from './skip-unchanged-writes'

/**
 * Where {@link store} persists its device slices on the web: `localStorage`, which turns into a no-op where it is missing or
 * refuses access (a private window, Node under vitest). Native builds load `device-storage.native.ts` instead.
 * @example createStorageMiddleware({ storage: deviceStorage, ... })
 */
export const deviceStorage = skipUnchangedWrites(createSafeLocalStorage())

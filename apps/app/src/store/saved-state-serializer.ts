import {
  defaultJsonSerializer,
  type Serializer,
} from '@laststance/redux-storage-middleware'
import { z } from 'zod'

// What the storage middleware saves under the store's key: its version and the slices it keeps.
const savedStateSchema = z.object({
  version: z.number().optional(),
  state: z.record(z.string(), z.unknown()),
})

// A save that holds no slice, so every slice keeps its initial state.
const NOTHING_SAVED = { version: 0, state: {} }

/**
 * The store's JSON serializer, which reads anything that is not a save the storage middleware made as a save that holds
 * nothing. The middleware would otherwise stop at such a value and skip every later save, so the value would stay for good
 * and every account would sync its zone again on every launch. A storage that refuses the read (a locked keychain) is not
 * handled here: the middleware then keeps what the device holds and saves nothing that session. Passed by {@link createAppStore}.
 * @example savedStateSerializer.deserialize('not json') // { version: 0, state: {} }
 * @example savedStateSerializer.deserialize('{"version":0,"state":{"syncedZone":{"byAccount":{}}}}') // the same save, parsed
 */
export const savedStateSerializer: Serializer = {
  serialize: (saved) => defaultJsonSerializer.serialize(saved),
  deserialize: (text) => {
    try {
      const parsed = savedStateSchema.safeParse(
        defaultJsonSerializer.deserialize(text),
      )
      return parsed.success ? parsed.data : NOTHING_SAVED
    } catch {
      // Text that is not JSON at all.
      return NOTHING_SAVED
    }
  },
}

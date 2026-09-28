import {
  createStorageMiddleware,
  type StateStorage,
} from '@laststance/redux-storage-middleware'
import {
  combineReducers,
  configureStore,
  createAction,
  type UnknownAction,
} from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import { z } from 'zod'

import { clockSlice } from './clock'
import { correctionSlice } from './correction'
import { deviceStorage } from './device-storage'
import { homeSlice } from './home'
import { registrationSlice } from './registration'
import { savedStateSerializer } from './saved-state-serializer'
import { restoreSyncedZone, syncedZoneSlice } from './synced-zone'

const appReducer = combineReducers({
  clock: clockSlice.reducer,
  correction: correctionSlice.reducer,
  home: homeSlice.reducer,
  registration: registrationSlice.reducer,
  syncedZone: syncedZoneSlice.reducer,
})

type AppState = ReturnType<typeof appReducer>

/**
 * Wipes every slice back to its initial state, except what this device remembers per account ({@link syncedZoneSlice});
 * dispatched by {@link useSignOut} so the next user never inherits client state.
 * @example store.dispatch(resetApp())
 */
export const resetApp = createAction('app/reset')

// A missing slice makes its reducer return its initial state; the clock re-syncs on its next tick.
const rootReducer = (
  state: AppState | undefined,
  action: UnknownAction,
): AppState =>
  appReducer(
    resetApp.match(action) ? { syncedZone: state?.syncedZone } : state,
    action,
  )

// Where the store keeps its device slices. Letters, digits, `.`, `-` and `_` only: SecureStore refuses any other key.
const DEVICE_KEY = 'switch-time.device'

// A save this build made: the storage middleware writes version 0 when the store names none.
const currentSaveSchema = z.object({
  version: z.literal(0),
  state: z.object({ syncedZone: z.unknown() }),
})

/**
 * The synced zones the device holds now, which another tab of the same browser may have saved since this tab read them, for
 * {@link syncedZonesReread}. Read synchronously, so {@link useTimeZoneSync} takes them in the same foreground as the device
 * zone ({@link useDeviceZone}) and judges its next sync on both at once, never on another tab's news alone.
 * @param storage - The store's device storage ({@link deviceStorage}).
 * @returns
 * - the saved `syncedZone`, of any shape (the reducer checks it)
 * - undefined when the key holds no save of this build, the storage answers later, or the read throws (a locked keychain)
 * @example store.dispatch(syncedZonesReread(savedSyncedZones(deviceStorage)))
 */
export function savedSyncedZones(storage: StateStorage): unknown {
  try {
    const text = storage.getItem(DEVICE_KEY)
    // A storage that answers later cannot land together with the device zone; both of this app's answer at once.
    if (typeof text !== 'string') return undefined
    return currentSaveSchema.safeParse(savedStateSerializer.deserialize(text))
      .data?.state.syncedZone
  } catch {
    // The launch's own read logs such a storage; this tab keeps its copy.
    return undefined
  }
}

/**
 * Builds the app's store over a device storage that keeps {@link syncedZoneSlice} across launches. The store reads it back
 * a few microtasks after it is built, so a synchronous storage has it in place before the first render and long before the
 * settings fetch that {@link useTimeZoneSync} waits for. Built once for the app ({@link store}) and once per test.
 * @param storage - Where the device slices live: {@link deviceStorage} in the app, an in-memory one in tests.
 * @returns The store.
 * @example const store = createAppStore(deviceStorage)
 */
export function createAppStore(storage: StateStorage) {
  const persistence = createStorageMiddleware<AppState>({
    rootReducer,
    // The per-account keys before it (`switch-time.synced-zone.<id>`) are left unread on purpose: each account syncs its zone
    // once more, then reads this one.
    key: DEVICE_KEY,
    slices: ['syncedZone'],
    storage,
    serializer: savedStateSerializer,
    merge: (persisted, current) => ({
      ...current,
      syncedZone: restoreSyncedZone(persisted.syncedZone, current.syncedZone),
    }),
  })
  return configureStore({
    reducer: persistence.reducer,
    // An undo slot holds the `Date`s `switches.replaceDay` takes; it never leaves memory, so the dev-only check skips it.
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: {
          ignoredPaths: ['correction.undo'],
          ignoredActionPaths: ['payload.slot'],
        },
      }).concat(persistence.middleware),
  })
}

/**
 * Client-only state (the clock, the correction sheet's 「元に戻す」, ホーム's refusal line, the address sign-up hands to sign-in, the zone this device
 * last synced per account). Server data, the user's settings included, lives in TanStack Query via {@link orpc}, never here.
 * @example <ReduxProvider store={store}>
 */
export const store = createAppStore(deviceStorage)

type RootState = ReturnType<typeof store.getState>
type AppDispatch = typeof store.dispatch

/**
 * {@link useSelector} typed to this store's state.
 * @example const now = useAppSelector((s) => s.clock.now)
 */
export const useAppSelector = useSelector.withTypes<RootState>()

/**
 * {@link useDispatch} typed to this store's dispatch.
 * @example const dispatch = useAppDispatch()
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()

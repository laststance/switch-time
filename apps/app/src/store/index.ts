import {
  combineReducers,
  configureStore,
  createAction,
  type UnknownAction,
} from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'

import { clockSlice } from './clock'
import { correctionSlice } from './correction'
import { registrationSlice } from './registration'

const appReducer = combineReducers({
  clock: clockSlice.reducer,
  correction: correctionSlice.reducer,
  registration: registrationSlice.reducer,
})

/**
 * Wipes every slice back to its initial state; dispatched by {@link useSignOut} so the next user never inherits client state.
 * @example store.dispatch(resetApp())
 */
export const resetApp = createAction('app/reset')

/**
 * Client-only state (the clock, the correction sheet's 「元に戻す」, the address sign-up hands to sign-in). Server data, the user's settings included, lives in
 * TanStack Query via {@link orpc}, never here.
 * @example <ReduxProvider store={store}>
 */
export const store = configureStore({
  // `undefined` state makes every slice reducer return its initial state; the clock re-syncs on its next tick.
  reducer: (
    state: ReturnType<typeof appReducer> | undefined,
    action: UnknownAction,
  ) => appReducer(resetApp.match(action) ? undefined : state, action),
  // An undo slot holds the `Date`s `switches.replaceDay` takes; it never leaves memory, so the dev-only check skips it.
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredPaths: ['correction.undo'],
        ignoredActionPaths: ['payload.slot'],
      },
    }),
})

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

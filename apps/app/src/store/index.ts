import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'

import { clockSlice } from './clock'
import { preferencesSlice } from './preferences'
import { uiSlice } from './ui'

/**
 * Client-only state (clock, ui, preferences). Server data lives in TanStack Query via {@link orpc}, never here.
 * @example <ReduxProvider store={store}>
 */
export const store = configureStore({
  reducer: {
    clock: clockSlice.reducer,
    ui: uiSlice.reducer,
    preferences: preferencesSlice.reducer,
  },
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

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

// Structural subset of react-native's AppState so this module (and its test) never loads react-native in node.
type AppStateLike = {
  currentState: string
  addEventListener(
    type: 'change',
    listener: (state: string) => void,
  ): { remove(): void }
}

/**
 * Wall-clock `now` every screen derives elapsed/remaining time from; driven by {@link startClock}.
 * @example const now = useAppSelector((s) => s.clock.now)
 */
export const clockSlice = createSlice({
  name: 'clock',
  // Lazy, so a reset (sign-in and sign-out both pass `undefined` state) reads the time then, not when this module loaded.
  initialState: () => ({ now: Date.now() }),
  reducers: {
    tick(state, action: PayloadAction<number>) {
      state.now = action.payload
    },
  },
})

/**
 * Ticks {@link clockSlice} once per second while the app is active, pauses in background and re-syncs the moment it resumes; returns the stop function ({@link useClock} owns the lifecycle).
 * @example const stop = startClock(store.dispatch, AppState)
 */
export function startClock(
  dispatch: (action: ReturnType<typeof clockSlice.actions.tick>) => unknown,
  appState: AppStateLike,
) {
  let timer: ReturnType<typeof setInterval> | undefined
  const run = (active: boolean): void => {
    clearInterval(timer)
    timer = undefined
    if (!active) return
    // Immediate tick so a long background gap is corrected before the next interval.
    dispatch(clockSlice.actions.tick(Date.now()))
    timer = setInterval(
      () => dispatch(clockSlice.actions.tick(Date.now())),
      1000,
    )
  }
  run(appState.currentState === 'active')
  const subscription = appState.addEventListener('change', (state) =>
    run(state === 'active'),
  )
  return (): void => {
    clearInterval(timer)
    subscription.remove()
  }
}

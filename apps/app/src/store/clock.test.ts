import { expect, test, vi } from 'vitest'

import { clockSlice, startClock } from './clock'

test('a reset at sign-in starts the clock at that moment, so the first screen after it never shows an earlier day', () => {
  // Arrange
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-25T00:00:05+09:00'))

  // Act
  const state = clockSlice.reducer(undefined, { type: 'app/reset' })
  vi.useRealTimers()

  // Assert
  expect(state.now).toBe(Date.parse('2026-09-25T00:00:05+09:00'))
})

test('the clock slice pauses ticking while the app is backgrounded', () => {
  // Arrange
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-09T10:00:00Z'))
  let state = clockSlice.getInitialState()
  const dispatch = (
    action: ReturnType<typeof clockSlice.actions.tick>,
  ): void => {
    state = clockSlice.reducer(state, action)
  }
  const listeners: ((next: string) => void)[] = []
  const appState = {
    currentState: 'active',
    addEventListener(_type: 'change', listener: (next: string) => void) {
      listeners.push(listener)
      return { remove: (): void => {} }
    },
  }

  // Act
  const stop = startClock(dispatch, appState)
  vi.advanceTimersByTime(3000)
  const afterThreeActiveSeconds = state.now
  listeners.forEach((listener) => listener('background'))
  vi.advanceTimersByTime(5000)
  const afterFiveBackgroundSeconds = state.now
  listeners.forEach((listener) => listener('active'))
  const onResume = state.now
  stop()
  vi.useRealTimers()

  // Assert
  expect(afterThreeActiveSeconds).toBe(Date.parse('2026-09-09T10:00:03Z'))
  expect(afterFiveBackgroundSeconds).toBe(Date.parse('2026-09-09T10:00:03Z'))
  expect(onResume).toBe(Date.parse('2026-09-09T10:00:08Z'))
})

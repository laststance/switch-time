import { useEffect } from 'react'
import { AppState } from 'react-native'

import { useAppDispatch } from '@/store'
import { startClock } from '@/store/clock'

/**
 * Runs the {@link startClock} ticker for the lifetime of the root layout; an effect so the static web export never starts a timer.
 * @example useClock()
 */
export function useClock() {
  const dispatch = useAppDispatch()
  useEffect(() => startClock(dispatch, AppState), [dispatch])
}

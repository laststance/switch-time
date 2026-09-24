import { useEffect, useState } from 'react'

/**
 * `flag`, but only once it has stayed true for `delayMs`: the correction sheet's 「反映しています…」 line reads it, so a write that
 * lands at once never mounts the line and shifts the footer. It turns false as soon as `flag` does.
 * @param flag - The live condition, e.g. a write in flight.
 * @param delayMs - How long `flag` must hold before it shows.
 * @returns
 * - true once `flag` has been true for `delayMs`
 * - false while `flag` is false, or has not held that long yet
 * @example const writing = useDelayedFlag(writesInFlight > 0, WRITING_LINE_DELAY_MS) // false for the first 400 ms of a write
 */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!flag) return
    const timer = setTimeout(() => setHeld(true), delayMs)
    // Reset on the way out, so the next write waits its own delay again.
    return (): void => {
      clearTimeout(timer)
      setHeld(false)
    }
  }, [flag, delayMs])
  return flag && held
}

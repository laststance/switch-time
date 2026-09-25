import { useState } from 'react'

/**
 * `flag`, but it stays true once it has been true: the (auth) layout reads it to tell the first session answer from a later refetch.
 * @param flag - The live condition, e.g. "the session query has answered".
 * @returns
 * - true from the first render where `flag` was true, whatever `flag` does afterwards
 * - false until then
 * @example const answered = useLatchedFlag(!isPending) // stays true while Better Auth refetches after sign-up
 */
export function useLatchedFlag(flag: boolean): boolean {
  const [latched, setLatched] = useState(flag)
  // Storing information from earlier renders: React re-renders at once with the new value.
  if (flag && !latched) setLatched(true)
  return latched
}

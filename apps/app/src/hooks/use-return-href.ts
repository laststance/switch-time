import { useUnstableGlobalHref } from 'expo-router'
import { useState } from 'react'

/**
 * The URL a signed-out visitor comes back to after sign-in (`next`). Follows the global href while the session is loading
 * or present, then keeps the last one: once the session reads empty, the redirect unmounts the (app) screens, the href
 * falls back to `/`, and a re-rendered redirect would send `next=/` instead of the open sheet. Used by {@link AppLayout}.
 * @param following - Whether the session is loading or present, so the href is still the one the visitor opened.
 * @returns Path plus query (a sheet's `?day=` included), as of the last render that was following.
 * @example useReturnHref(isPending || Boolean(session)) // '/correction?day=2026-09-24'
 */
export function useReturnHref(following: boolean): string {
  const href = useUnstableGlobalHref()
  const [kept, setKept] = useState(href)
  // Adjusted during render, so the redirect never commits with an href older than the screen it leaves.
  if (following && href !== kept) setKept(href)
  return kept
}

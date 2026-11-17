import { useGlobalSearchParams, type Href } from 'expo-router'
import { useState } from 'react'

import { nextHref } from '@/hooks/use-auth-form'

/**
 * Keeps the requested destination stable while a successful sign-in redirects.
 *
 * {@link AuthLayout} follows the global query until a session lands. Expo clears
 * that query before its queued redirect unmounts the layout, so following it
 * afterwards would replace the requested path and query with Home.
 *
 * @param following - Whether the visitor is still waiting to sign in.
 * @returns The last safe destination observed before authentication completed.
 * @example
 * ```tsx
 * const returnTo = useAuthDestination(!session)
 * ```
 */
export function useAuthDestination(following: boolean): Href {
  const { next } = useGlobalSearchParams<{ next?: string | string[] }>()
  const destination = nextHref(next)
  const [kept, setKept] = useState(destination)
  // Update during render so a newly requested URL is reflected before navigation commits.
  if (following && kept !== destination) setKept(destination)
  return kept
}

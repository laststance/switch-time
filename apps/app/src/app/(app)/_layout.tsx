import { Redirect, Stack, useUnstableGlobalHref } from 'expo-router'

import { authClient } from '@/lib/auth-client'

// Everything under (app) needs a session: anonymous visitors go to sign-in and come back to the route they wanted.
export default function AppLayout() {
  const { data: session, isPending } = authClient.useSession()
  // Path plus query, so `next` brings the visitor back to the exact URL they opened (a sheet's `?day=` included).
  const href = useUnstableGlobalHref()
  // Only the first load hides the shell: Better Auth keeps `data` while it refetches (isPending is true whenever data is null), and unmounting the Stack on every window focus would reset every screen and open sheet.
  if (isPending) return null
  if (!session)
    return <Redirect href={{ pathname: '/sign-in', params: { next: href } }} />
  return <Stack screenOptions={{ headerShown: false }} />
}

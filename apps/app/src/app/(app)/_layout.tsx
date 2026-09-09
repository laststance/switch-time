import { Redirect, Stack, useUnstableGlobalHref } from 'expo-router'

import { authClient } from '@/lib/auth-client'

// Everything under (app) needs a session: anonymous visitors go to sign-in and come back to the route they wanted.
export default function AppLayout() {
  const { data: session, isPending, isRefetching } = authClient.useSession()
  // Path plus query, so `next` brings the visitor back to the exact URL they opened (a sheet's `?day=` included).
  const href = useUnstableGlobalHref()
  if (isPending || isRefetching) return null
  if (!session)
    return <Redirect href={{ pathname: '/sign-in', params: { next: href } }} />
  return <Stack screenOptions={{ headerShown: false }} />
}

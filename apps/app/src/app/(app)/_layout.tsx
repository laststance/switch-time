import { Redirect, Stack, usePathname } from 'expo-router'

import { authClient } from '@/lib/auth-client'

// Everything under (app) needs a session: anonymous visitors go to sign-in and come back to the route they wanted.
export default function AppLayout() {
  const { data: session, isPending, isRefetching } = authClient.useSession()
  const pathname = usePathname()
  if (isPending || isRefetching) return null
  if (!session)
    return (
      <Redirect href={{ pathname: '/sign-in', params: { next: pathname } }} />
    )
  return <Stack screenOptions={{ headerShown: false }} />
}

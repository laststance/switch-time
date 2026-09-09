import { Redirect, Stack } from 'expo-router'

import { authClient } from '@/lib/auth-client'

// A signed-in user has no business on the auth screens; the screens themselves navigate after success.
export default function AuthLayout() {
  const { data: session, isPending } = authClient.useSession()
  if (isPending) return null
  if (session) return <Redirect href="/" />
  return <Stack screenOptions={{ headerShown: false }} />
}

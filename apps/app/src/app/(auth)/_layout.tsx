import { Redirect, Stack, useGlobalSearchParams } from 'expo-router'

import { nextHref } from '@/hooks/use-auth-form'
import { authClient } from '@/lib/auth-client'

// A signed-in user has no business on the auth screens. This redirect lands before the screen's own replace after a
// successful submit (the session arrives first), so it honours `next` as well.
export default function AuthLayout() {
  const { data: session, isPending } = authClient.useSession()
  const { next } = useGlobalSearchParams<{ next?: string }>()
  if (isPending) return null
  if (session) return <Redirect href={nextHref(next)} />
  return <Stack screenOptions={{ headerShown: false }} />
}

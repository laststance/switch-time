import { Redirect, Stack, useGlobalSearchParams } from 'expo-router'

import { nextHref } from '@/hooks/use-auth-form'
import { authClient } from '@/lib/auth-client'

// A signed-in user has no business on the auth screens, and this is the one place that navigates after sign-in / sign-up:
// it fires once the session has landed, so the (app) guard never sees the gap between the auth response and get-session.
export default function AuthLayout() {
  const { data: session, isPending } = authClient.useSession()
  const { next } = useGlobalSearchParams<{ next?: string }>()
  if (isPending) return null
  if (session) return <Redirect href={nextHref(next)} />
  return <Stack screenOptions={{ headerShown: false }} />
}

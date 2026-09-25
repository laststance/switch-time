import { Redirect, Stack, useGlobalSearchParams } from 'expo-router'

import { nextHref } from '@/hooks/use-auth-form'
import { useLatchedFlag } from '@/hooks/use-latched-flag'
import { authClient } from '@/lib/auth-client'

// A signed-in user has no business on the auth screens, and this is the one place that navigates after sign-in:
// it fires once the session has landed, so the (app) guard never sees the gap between the auth response and get-session.
export default function AuthLayout() {
  const { data: session, isPending } = authClient.useSession()
  const { next } = useGlobalSearchParams<{ next?: string | string[] }>()
  // Only the first session answer hides the screens. Better Auth refetches after every sign-up and sign-in, and with no session
  // that refetch reports isPending again: hiding then would unmount the Stack between sign-up and the move to sign-in.
  const answered = useLatchedFlag(!isPending)
  if (!answered) return null
  if (session) return <Redirect href={nextHref(next)} />
  return <Stack screenOptions={{ headerShown: false }} />
}

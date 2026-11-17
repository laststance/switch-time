import { Redirect, Stack } from 'expo-router'

import { useAuthConfig } from '@/hooks/use-auth-config'
import { useAuthDestination } from '@/hooks/use-auth-destination'
import { useLatchedFlag } from '@/hooks/use-latched-flag'
import { authClient } from '@/lib/auth-client'

// A signed-in user has no business on the auth screens, and this is the one place that navigates after sign-in:
// it fires once the session has landed, so the (app) guard never sees the gap between the auth response and get-session.
export default function AuthLayout() {
  const { data: session, isPending } = authClient.useSession()
  const returnTo = useAuthDestination(!session)
  // Asked here so the answer is in by the time a screen needs it (sign-in's forgot link, sign-up's notice).
  useAuthConfig()
  // Only the first session answer hides the screens. Better Auth refetches after every sign-up and sign-in, and with no session
  // that refetch reports isPending again: hiding then would unmount the Stack between sign-up and the move to sign-in.
  const answered = useLatchedFlag(!isPending)
  if (!answered) return null
  if (session) return <Redirect href={returnTo} />
  return <Stack screenOptions={{ headerShown: false }} />
}

import { Redirect, Stack, usePathname } from 'expo-router'
import { Platform } from 'react-native'

import { authClient } from '@/lib/auth-client'

// Sheets are routes: native shows the system modal, web gets a transparent unanimated screen and Sheet draws the scrim itself.
const sheet = {
  presentation: Platform.OS === 'web' ? 'transparentModal' : 'modal',
  animation: Platform.OS === 'web' ? 'none' : 'default',
} as const

// Everything under (app) needs a session: anonymous visitors go to sign-in and come back to the route they wanted.
export default function AppLayout() {
  const { data: session, isPending } = authClient.useSession()
  const pathname = usePathname()
  // Only the first load hides the shell: Better Auth keeps `data` while it refetches (isPending is true whenever data is null), and unmounting the Stack on every window focus would reset every screen and open sheet.
  if (isPending) return null
  if (!session)
    return (
      <Redirect href={{ pathname: '/sign-in', params: { next: pathname } }} />
    )
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="correction" options={sheet} />
      <Stack.Screen name="activity-editor" options={sheet} />
      <Stack.Screen name="excluded-days" options={sheet} />
    </Stack>
  )
}

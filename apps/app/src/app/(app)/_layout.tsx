import { Redirect, Stack, useUnstableGlobalHref } from 'expo-router'
import { useEffect } from 'react'
import { Platform } from 'react-native'

import { authClient } from '@/lib/auth-client'
import { queryClient } from '@/lib/query'
import { useAppDispatch, useAppSelector } from '@/store'
import { correctionSlice } from '@/store/correction'

// Sheets are routes: native shows the system modal, web gets a transparent unanimated screen and Sheet draws the scrim itself.
const sheet = {
  presentation: Platform.OS === 'web' ? 'transparentModal' : 'modal',
  animation: Platform.OS === 'web' ? 'none' : 'default',
} as const

// Everything under (app) needs a session: anonymous visitors go to sign-in and come back to the route they wanted.
export default function AppLayout() {
  const { data: session, isPending } = authClient.useSession()
  // Path plus query, so `next` brings the visitor back to the exact URL they opened (a sheet's `?day=` included).
  const href = useUnstableGlobalHref()
  const dispatch = useAppDispatch()
  const account = session?.user.id
  const seen = useAppSelector((s) => s.correction.account)
  // The session refetches on focus, so a sign-in as someone else in another tab shows up here, without this tab's sign-in or
  // sign-out running: nothing of the previous account may stay on screen (the cache) or in an undo (the store).
  useEffect(() => {
    if (!account || account === seen) return
    if (seen) void queryClient.resetQueries()
    dispatch(correctionSlice.actions.accountSeen(account))
  }, [account, seen, dispatch])
  // Only the first load hides the shell: Better Auth keeps `data` while it refetches (isPending is true whenever data is null), and unmounting the Stack on every window focus would reset every screen and open sheet.
  if (isPending) return null
  if (!session)
    return <Redirect href={{ pathname: '/sign-in', params: { next: href } }} />
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="correction" options={sheet} />
      <Stack.Screen name="activity-editor" options={sheet} />
      <Stack.Screen name="excluded-days" options={sheet} />
    </Stack>
  )
}

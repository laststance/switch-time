import { useQuery } from '@tanstack/react-query'
import { Redirect } from 'expo-router'
import { Text, View } from 'react-native'

import { Readout } from '@/components/readout'
import { orpc } from '@/lib/orpc'
import { useAppSelector } from '@/store'

// Dev-only wiring check: API ping + the authed `me` procedure through oRPC + TanStack Query (proves the session rides along,
// natively as a Cookie header), and the Redux clock. Hooks run before the redirect so their order is stable.
export default function DebugScreen() {
  const ping = useQuery(orpc.ping.queryOptions())
  const me = useQuery(orpc.me.queryOptions())
  const now = useAppSelector((s) => s.clock.now)
  if (!__DEV__) return <Redirect href="/" />

  const describe = (query: typeof ping | typeof me) => {
    if (query.error) return `error: ${query.error.message}`
    return query.data ? JSON.stringify(query.data) : '…'
  }

  return (
    <View className="bg-bg flex-1 items-center justify-center gap-4 p-5">
      <Text className="text-sub text-xs">ping</Text>
      <Text className="text-ink text-sm">{describe(ping)}</Text>
      <Text className="text-sub text-xs">me</Text>
      <Text className="text-ink text-sm">{describe(me)}</Text>
      <Text className="text-sub text-xs">clock</Text>
      <Readout className="text-lg">
        {new Date(now).toLocaleTimeString()}
      </Readout>
    </View>
  )
}

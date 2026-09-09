import { useQuery } from '@tanstack/react-query'
import { Redirect } from 'expo-router'
import { Text, View } from 'react-native'

import { Readout } from '@/components/readout'
import { orpc } from '@/lib/orpc'
import { useAppSelector } from '@/store'

// Dev-only wiring check: API ping through oRPC + TanStack Query, and the Redux clock. Hooks run before the redirect so their order is stable.
export default function DebugScreen() {
  const ping = useQuery(orpc.ping.queryOptions())
  const now = useAppSelector((s) => s.clock.now)
  if (!__DEV__) return <Redirect href="/" />

  let pingText = '…'
  if (ping.error) pingText = `error: ${ping.error.message}`
  else if (ping.data) pingText = JSON.stringify(ping.data)

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg p-5">
      <Text className="text-xs text-sub">ping</Text>
      <Text className="text-sm text-ink">{pingText}</Text>
      <Text className="text-xs text-sub">clock</Text>
      <Readout className="text-lg">
        {new Date(now).toLocaleTimeString()}
      </Readout>
    </View>
  )
}

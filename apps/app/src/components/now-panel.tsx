import { Text, View } from 'react-native'

import { Dial } from '@/components/dial'
import { Readout } from '@/components/readout'
import { useWide } from '@/hooks/use-wide'
import { formatElapsed } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppSelector } from '@/store'

// Wide web sits the 176 px dial beside the status block inside a surface card; phones stack the 236 px dial over a centred block.
const BANDS = {
  wide: {
    root: 'flex-row flex-wrap items-center gap-6 rounded-card border border-line bg-surface p-6',
    dial: 176,
    status: 'min-w-[220px] flex-1 items-start gap-1',
    name: 'text-xl',
  },
  narrow: {
    root: 'items-center gap-4',
    dial: 236,
    status: 'items-center gap-0.5',
    name: 'text-lg',
  },
}

type NowPanelProps = {
  activity: { name: string; color: string }
  startedAt: number
  /** `H:MM` of `startedAt` in the user's time zone (the 「から」 line). */
  since: string
  switchCount: number
}

/**
 * The hero of Home: the dial, the current activity in its own colour and the elapsed time ticking from the clock slice.
 * @example <NowPanel activity={activity} startedAt={current.startedAt.getTime()} since="9:05" switchCount={3} />
 */
export function NowPanel({
  activity,
  startedAt,
  since,
  switchCount,
}: NowPanelProps) {
  const band = BANDS[useWide() ? 'wide' : 'narrow']
  const now = useAppSelector((s) => s.clock.now)
  return (
    <View className={band.root}>
      <Dial size={band.dial} color={activity.color} />
      <View className={band.status}>
        <View className="flex-row items-center gap-2">
          <View
            className="h-2.5 w-2.5 rounded-pill"
            style={{ backgroundColor: activity.color }}
          />
          <Text
            className={cn('font-bold tracking-tight', band.name)}
            style={{ color: activity.color }}
          >
            {activity.name}
          </Text>
        </View>
        <Readout>{formatElapsed(now - startedAt)}</Readout>
        <Text className="text-xs text-sub">
          {since} から · 今日 {switchCount} 回切替
        </Text>
      </View>
    </View>
  )
}

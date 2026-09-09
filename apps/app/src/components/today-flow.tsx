import { Text, View } from 'react-native'

import { useWide } from '@/hooks/use-wide'
import { cn } from '@/lib/utils'

// Wide web frames the bar as the 「今日の流れ」 card with a legend; phones show the bare 10 px bar under the switch row.
const BANDS = {
  wide: {
    root: 'gap-3 rounded-card border border-line bg-surface px-5 pb-4 pt-[18px]',
    bar: 'h-3.5 rounded-[7px]',
    labels: ['0:00', '6:00', '12:00', '18:00', '24:00'],
  },
  narrow: {
    root: 'gap-1.5 py-2',
    bar: 'h-2.5 rounded-[5px]',
    labels: ['0:00', '12:00', '24:00'],
  },
}

type Segment = {
  switchId: string
  activityId: string
  start: number
  end: number
  idle: boolean
}

type TodayFlowProps = {
  segments: Segment[]
  activities: { id: string; name: string; color: string }[]
  /** The day's bounds in ms; the bar is exactly 24 h wide (「1本 = 24時間」). */
  start: number
  end: number
}

/**
 * The 24-hour bar: one absolutely placed slice per segment in its activity colour; idle segments (past the idle threshold) are
 * dashed over the `chip` fill on both platforms. Ponytail: the native hatch pattern is skipped, dashed reads the same.
 * @example <TodayFlow segments={segments} activities={activities} start={start} end={end} />
 */
export function TodayFlow({
  segments,
  activities,
  start,
  end,
}: TodayFlowProps) {
  const wide = useWide()
  const band = BANDS[wide ? 'wide' : 'narrow']
  const colors = Object.fromEntries(
    activities.map((activity) => [activity.id, activity.color]),
  )
  const percent = (ms: number): `${number}%` => `${(ms / (end - start)) * 100}%`
  return (
    <View className={band.root}>
      {wide && (
        <>
          <View className="flex-row items-baseline justify-between">
            <Text className="text-sm font-semibold text-ink">今日の流れ</Text>
            <Text className="text-xs text-sub">1本 = 24時間</Text>
          </View>
          <View className="flex-row flex-wrap gap-x-3.5 gap-y-1.5">
            {activities
              .filter((activity) =>
                segments.some((segment) => segment.activityId === activity.id),
              )
              .map((activity) => (
                <View
                  key={activity.id}
                  className="flex-row items-center gap-1.5"
                >
                  <View
                    className="h-2 w-2 rounded-[2px]"
                    style={{ backgroundColor: activity.color }}
                  />
                  <Text className="text-xs text-sub">{activity.name}</Text>
                </View>
              ))}
          </View>
        </>
      )}
      <View
        role="img"
        aria-label="今日の流れ"
        className={cn('w-full overflow-hidden bg-chip', band.bar)}
      >
        {segments.map((segment) => (
          <View
            key={segment.switchId}
            className={cn(
              'absolute inset-y-0',
              segment.idle && 'border border-dashed border-line',
            )}
            style={{
              left: percent(segment.start - start),
              width: percent(segment.end - segment.start),
              backgroundColor: segment.idle
                ? undefined
                : colors[segment.activityId],
            }}
          />
        ))}
      </View>
      <View className="flex-row justify-between">
        {band.labels.map((label) => (
          <Text key={label} className="text-2xs text-sub">
            {label}
          </Text>
        ))}
      </View>
    </View>
  )
}

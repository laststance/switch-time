import { Text, View } from 'react-native'

import { useWide } from '@/hooks/use-wide'
import { legendEntries } from '@/lib/today'
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
  /** null = detox: outlined like an idle span. */
  activityId: string | null
  start: number
  end: number
  idle: boolean
}

// A span or legend square with no colour (idle past the threshold, or detox) is outlined over the `chip` track; the rest fill.
const paint = (color: string | null | undefined) =>
  color === null
    ? {
        className: 'border border-dashed border-line',
        backgroundColor: undefined,
      }
    : { className: '', backgroundColor: color }
const slice = (segment: Segment, colors: Record<string, string>) =>
  paint(
    segment.idle || segment.activityId === null
      ? null
      : colors[segment.activityId],
  )

type TodayFlowProps = {
  segments: Segment[]
  activities: { id: string; name: string; color: string }[]
  /** The day's bounds in ms; the bar is exactly 24 h wide (「1本 = 24時間」). */
  start: number
  end: number
}

/**
 * The 24-hour bar: one absolutely placed slice per segment in its activity colour; idle segments (past the idle threshold) and
 * detox spans (no activity) are dashed over the `chip` fill on both platforms. Ponytail: the native hatch pattern is skipped, dashed reads the same.
 * The wide legend ({@link legendEntries}) names every activity drawn, and detox when a span was recorded to nothing.
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
  // ponytail: labels are spaced evenly while slices are placed by elapsed time, so on the two DST days a year they drift
  // by up to an hour of the bar's width; place each label at its own wall-clock percentage if a DST zone ever matters.
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
            {legendEntries(activities, segments).map((entry) => {
              const look = paint(entry.color)
              return (
                <View key={entry.id} className="flex-row items-center gap-1.5">
                  <View
                    className={cn('h-2 w-2 rounded-[2px]', look.className)}
                    style={{ backgroundColor: look.backgroundColor }}
                  />
                  <Text className="text-xs text-sub">{entry.name}</Text>
                </View>
              )
            })}
          </View>
        </>
      )}
      <View
        role="img"
        aria-label="今日の流れ"
        className={cn('w-full overflow-hidden bg-chip', band.bar)}
      >
        {segments.map((segment) => {
          const look = slice(segment, colors)
          return (
            <View
              key={segment.switchId}
              className={cn('absolute inset-y-0', look.className)}
              style={{
                left: percent(segment.start - start),
                width: percent(segment.end - segment.start),
                backgroundColor: look.backgroundColor,
              }}
            />
          )
        })}
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

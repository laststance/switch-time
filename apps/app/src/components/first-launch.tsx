import { DEFAULT_ACTIVITIES } from '@switch-time/shared'
import { Link } from 'expo-router'
import { Text, View } from 'react-native'
import Svg, { Circle, Line } from 'react-native-svg'

import { SwitchButton } from '@/components/switch-button'
import { useActivities } from '@/hooks/use-activities'
import { useSwitchTo } from '@/hooks/use-switch-to'
import { useTokenColor } from '@/hooks/use-token-color'

// The logo's four arcs are the first four default activities, in their palette colours.
const ARCS = [
  { color: DEFAULT_ACTIVITIES[0].color, dash: '66 198', offset: 0 },
  { color: DEFAULT_ACTIVITIES[1].color, dash: '60 204', offset: -70 },
  { color: DEFAULT_ACTIVITIES[2].color, dash: '44 220', offset: -134 },
  { color: DEFAULT_ACTIVITIES[3].color, dash: '80 184', offset: -182 },
]

/**
 * 初回起動: shown while the user has no switch yet. The first tap is `switchTo`, which flips `switches.current` and so swaps this for Home.
 * @example {current === null ? <FirstLaunch /> : <HomeBody />}
 */
export function FirstLaunch() {
  const activities = useActivities().data ?? []
  const switchTo = useSwitchTo()
  const ink = useTokenColor('ink')
  return (
    <View className="items-center gap-3.5 pt-8">
      <View className="h-[88px] w-[88px] items-center justify-center rounded-[26px] bg-face text-ink">
        <Svg width={88} height={88} viewBox="0 0 120 120" color={ink}>
          {ARCS.map((arc) => (
            <Circle
              key={arc.color}
              cx={60}
              cy={60}
              r={42}
              fill="none"
              stroke={arc.color}
              strokeWidth={9}
              strokeDasharray={arc.dash}
              strokeDashoffset={arc.offset}
            />
          ))}
          <Line
            x1={60}
            y1={64}
            x2={60}
            y2={38}
            stroke="currentColor"
            strokeWidth={5}
            strokeLinecap="round"
          />
          <Line
            x1={60}
            y1={62}
            x2={80}
            y2={62}
            stroke="currentColor"
            strokeWidth={4}
            strokeLinecap="round"
          />
          <Circle cx={60} cy={60} r={4} fill="currentColor" />
        </Svg>
      </View>
      <Text
        role="heading"
        aria-level={1}
        className="text-center text-xl font-bold tracking-tight text-ink"
      >
        いま何をしている？
      </Text>
      <Text className="max-w-[280px] text-center text-sm leading-[25px] text-sub">
        タップした瞬間から時間が積み上がります。記録を止める操作はありません。
      </Text>
      <View className="w-full flex-row flex-wrap gap-2.5 pt-2.5">
        {activities.map((activity) => (
          <SwitchButton
            key={activity.id}
            name={activity.name}
            color={activity.color}
            iconKey={activity.iconKey}
            tint={activity.color}
            active={false}
            onPress={() => switchTo.mutate({ activityId: activity.id })}
          />
        ))}
      </View>
      <Link href="/settings">
        <Text className="py-3 text-xs font-medium text-sub underline">
          項目をあとで編集する
        </Text>
      </Link>
    </View>
  )
}

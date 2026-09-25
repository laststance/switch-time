import { DEFAULT_ACTIVITIES } from '@switch-time/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'expo-router'
import { Text, View } from 'react-native'
import Svg, { Circle, Line } from 'react-native-svg'

import { DetoxRow } from '@/components/detox-row'
import { SwitchButton } from '@/components/switch-button'
import { useActivities } from '@/hooks/use-activities'
import { useSwitchHotkeys } from '@/hooks/use-switch-hotkeys'
import { useSwitchTo } from '@/hooks/use-switch-to'
import { useTokenColor } from '@/hooks/use-token-color'
import { sendsPick } from '@/lib/home'
import { type CurrentSwitch, orpc } from '@/lib/orpc'

// The logo's four arcs are the first four default activities, in their palette colours.
const ARCS = [
  { color: DEFAULT_ACTIVITIES[0].color, dash: '66 198', offset: 0 },
  { color: DEFAULT_ACTIVITIES[1].color, dash: '60 204', offset: -70 },
  { color: DEFAULT_ACTIVITIES[2].color, dash: '44 220', offset: -134 },
  { color: DEFAULT_ACTIVITIES[3].color, dash: '80 184', offset: -182 },
]

/**
 * 初回起動: shown while the user has no switch yet. The first tap is `switchTo` (an activity button, or detox from the
 * {@link DetoxRow} under the buttons, or the digit hotkeys on web, {@link useSwitchHotkeys}), which flips `switches.current` and so swaps this for Home.
 * @example {current === null ? <FirstLaunch /> : <HomeBody />}
 */
export function FirstLaunch() {
  const activities = useActivities().data ?? []
  const switchTo = useSwitchTo()
  const ink = useTokenColor('ink')
  const queryClient = useQueryClient()
  const pick = (activityId: string | null): void => {
    // Two keys inside one frame: the second finds the first one's row in the cache before Home takes over, and a re-tap of it
    // (a fresh run has nothing to renew) sends nothing.
    const placed = queryClient.getQueryData<CurrentSwitch | null>(
      orpc.switches.current.queryKey(),
    )
    if (!placed || sendsPick({ activityId, current: placed, renewable: false }))
      switchTo.mutate({ activityId })
  }
  useSwitchHotkeys(activities, pick)
  return (
    <View className="items-center gap-3.5 pt-8">
      <View className="bg-face text-ink h-22 w-22 items-center justify-center rounded-[26px]">
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
        className="text-ink text-center text-xl font-bold tracking-tight"
      >
        いま何をしている？
      </Text>
      <Text className="text-sub max-w-70 text-center text-sm leading-6.25">
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
        {/* Inside the wrapping row, as the pen's 初回起動 board draws it: it keeps the buttons' 10px gap (Home leaves 16px), and
            full width gives it a line of its own under them. A new account can start on detox without recording an activity first. */}
        <DetoxRow
          active={false}
          onPress={() => switchTo.mutate({ activityId: null })}
        />
      </View>
      <Link href="/settings">
        <Text className="text-sub py-3 text-xs font-medium underline">
          項目をあとで編集する
        </Text>
      </Link>
    </View>
  )
}

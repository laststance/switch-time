import { Link, usePathname } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

import { FirstLaunch } from '@/components/first-launch'
import { NowPanel } from '@/components/now-panel'
import { RetryNotice } from '@/components/retry-notice'
import { Screen } from '@/components/screen'
import { ScreenHeader } from '@/components/screen-header'
import { StrokeIcon } from '@/components/stroke-icon'
import { SwitchButton } from '@/components/switch-button'
import { TodayFlow } from '@/components/today-flow'
import { useActivities, useAllActivities } from '@/hooks/use-activities'
import { useCurrentActivity } from '@/hooks/use-current-activity'
import { useSwitchTo } from '@/hooks/use-switch-to'
import { useToday } from '@/hooks/use-today'
import { useTokenColor } from '@/hooks/use-token-color'
import { useWebKeydown } from '@/hooks/use-web-keydown'
import { formatDay, formatTime } from '@/lib/format'
import { homeFallback } from '@/lib/home'
import { hotkeyIndex } from '@/lib/hotkeys'

const PENCIL = 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'

type Current = ReturnType<typeof useCurrentActivity>
type HomeBodyProps = {
  current: NonNullable<Current['current']>
  activity: NonNullable<Current['activity']>
}

// ホーム proper: header with the date and the 訂正 entry, the hero, the switch row and the 24-h bar.
function HomeBody({ current, activity }: HomeBodyProps) {
  const live = useActivities().data ?? []
  // A state archived from another device keeps its button (last, so the digit hotkeys keep their places) until the next switch:
  // exactly one button is always the active one, and the row never loses the state the hero is showing.
  const activities = live.some((row) => row.id === activity.id)
    ? live
    : [...live, activity]
  const allActivities = useAllActivities().data ?? []
  const switchTo = useSwitchTo()
  const { today, timeZone, start, end, segments, switchCount } = useToday()
  const ink = useTokenColor('ink')
  const pathname = usePathname()
  // Pressing the active state again is a no-op on the server too; skipping it saves the three refetches the mutation triggers.
  const pick = (activityId: string) => {
    if (activityId !== current.activityId) switchTo.mutate({ activityId })
  }
  useWebKeydown((event) => {
    // A sheet above Home (or another tab, Home stays mounted) owns the keyboard.
    if (pathname !== '/') return
    const picked = activities[hotkeyIndex(event)]
    if (picked) pick(picked.id)
  })
  return (
    <Screen>
      <ScreenHeader title="いま" aside={formatDay(today)}>
        <Link href="/correction" asChild>
          <Pressable className="h-11 flex-row items-center gap-1.5 rounded-pill border border-line bg-surface px-4 text-ink">
            <StrokeIcon d={PENCIL} size={15} strokeWidth={2} color={ink} />
            <Text className="text-xs font-semibold text-ink">訂正</Text>
          </Pressable>
        </Link>
      </ScreenHeader>
      <NowPanel
        activity={activity}
        startedAt={current.startedAt.getTime()}
        since={formatTime(current.startedAt, timeZone)}
        switchCount={switchCount}
      />
      <View className="flex-row items-baseline justify-between">
        <Text className="text-sm font-semibold text-ink">切り替え</Text>
        <Text className="text-xs text-sub">押した瞬間から積み上がります</Text>
      </View>
      <View className="flex-row flex-wrap gap-2.5">
        {activities.map((item) => (
          <SwitchButton
            key={item.id}
            name={item.name}
            color={item.color}
            iconKey={item.iconKey}
            active={item.id === current.activityId}
            onPress={() => pick(item.id)}
          />
        ))}
      </View>
      <TodayFlow
        segments={segments}
        activities={allActivities}
        start={start}
        end={end}
      />
    </Screen>
  )
}

export default function HomeScreen() {
  const { current, activity, isPending, isError, retry } = useCurrentActivity()
  if (current && activity)
    return <HomeBody current={current} activity={activity} />
  const fallback = {
    error: <RetryNotice onRetry={retry} />,
    'first-launch': <FirstLaunch />,
    loading: <ScreenHeader title="いま" />,
  }
  return (
    <Screen>
      {
        fallback[
          homeFallback({ isPending, isError, hasCurrent: current !== null })
        ]
      }
    </Screen>
  )
}

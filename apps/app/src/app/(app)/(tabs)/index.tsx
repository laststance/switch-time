import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

import { DetoxRow } from '@/components/detox-row'
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
import { useSwitchHotkeys } from '@/hooks/use-switch-hotkeys'
import { useSwitchTo } from '@/hooks/use-switch-to'
import { useToday } from '@/hooks/use-today'
import { useTokenColor } from '@/hooks/use-token-color'
import { formatDay, formatSince } from '@/lib/format'
import {
  detoxNotice,
  detoxPastWeek,
  detoxRenewable,
  gridActivities,
  homeFallback,
  homeReady,
  nowLook,
  sendsPick,
} from '@/lib/home'
import { PENCIL } from '@/lib/icons'
import { type CurrentSwitch, orpc } from '@/lib/orpc'

type Current = ReturnType<typeof useCurrentActivity>
type HomeBodyProps = {
  current: NonNullable<Current['current']>
  /** Null while the current state is detox. */
  activity: Current['activity']
}

// ホーム proper: header with the date and the 訂正 entry, the hero, the switch row with the detox row under it, and the 24-h bar.
function HomeBody({ current, activity }: HomeBodyProps) {
  const activities = gridActivities(useActivities().data ?? [], activity)
  const allActivities = useAllActivities().data ?? []
  const switchTo = useSwitchTo()
  const {
    today,
    timeZone,
    autoExcludeUnusedDays,
    ready,
    start,
    end,
    segments,
    switchCount,
  } = useToday()
  const homeToday = {
    current,
    today,
    switchCountToday: switchCount,
    autoExcludeUnusedDays,
  }
  // The server's class for today says whether a detox past its week still measures it; only a detox run older than the week
  // with no tap today can be past it, so nothing else asks (stats.day scans the whole history).
  const todayStats = useQuery(
    orpc.stats.day.queryOptions({
      input: { day: today },
      enabled: ready && detoxPastWeek(homeToday),
    }),
  )
  const notice = detoxNotice({ ...homeToday, stats: todayStats })
  const renewable = detoxRenewable(homeToday)
  const ink = useTokenColor('ink')
  const queryClient = useQueryClient()
  const pick = (activityId: string | null): void => {
    // Two keys inside one frame: the second must weigh the first one's row, which is in the cache before Home re-renders.
    const shown =
      queryClient.getQueryData<CurrentSwitch | null>(
        orpc.switches.current.queryKey(),
      ) ?? current
    // `renewable` was worked out for the rendered row; a different row in the cache (a tap's placeholder, or a refetch Home has
    // not rendered yet) does not renew here.
    if (
      sendsPick({
        activityId,
        current: shown,
        renewable: renewable && shown.id === current.id,
      })
    )
      switchTo.mutate({ activityId })
  }
  useSwitchHotkeys(activities, pick)
  return (
    <Screen>
      <ScreenHeader title="いま" aside={formatDay(today)}>
        <Link href="/correction" asChild>
          <Pressable className="border-line bg-surface text-ink h-11 flex-row items-center gap-1.5 rounded-pill border px-4">
            <StrokeIcon d={PENCIL} size={15} strokeWidth={2} color={ink} />
            <Text className="text-ink text-xs font-semibold">訂正</Text>
          </Pressable>
        </Link>
      </ScreenHeader>
      <NowPanel
        look={nowLook(
          activity,
          formatSince(current.startedAt, today, timeZone),
          switchCount,
          notice,
        )}
        startedAt={current.startedAt.getTime()}
      />
      <View className="flex-row items-baseline justify-between">
        <Text className="text-ink text-sm font-semibold">切り替え</Text>
        <Text className="text-sub text-xs">押した瞬間から積み上がります</Text>
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
      <DetoxRow
        active={current.activityId === null}
        renewable={renewable}
        onPress={() => pick(null)}
      />
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
  const { current, activity, activitiesLoaded, isPending, isError, retry } =
    useCurrentActivity()
  if (current && homeReady({ current, activity, activitiesLoaded }))
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

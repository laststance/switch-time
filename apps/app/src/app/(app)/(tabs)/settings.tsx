import type { ThemeMode } from '@switch-time/shared'
import { Link } from 'expo-router'
import { Platform, Pressable, Text, View } from 'react-native'

import { RetryNotice } from '@/components/retry-notice'
import { Screen } from '@/components/screen'
import { ScreenHeader } from '@/components/screen-header'
import { Segmented } from '@/components/segmented'
import { SignOutButton } from '@/components/sign-out-button'
import { StrokeIcon } from '@/components/stroke-icon'
import { TimeZoneRow } from '@/components/time-zone-row'
import { Toggle } from '@/components/ui/toggle'
import { useActivities } from '@/hooks/use-activities'
import { useSettings, useUpdateSettings } from '@/hooks/use-settings'
import { useTokenColor } from '@/hooks/use-token-color'
import { INFO } from '@/lib/icons'
import { exclusionSummary } from '@/lib/settings'
import { cn } from '@/lib/utils'

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'auto', label: '自動' },
  { value: 'light', label: '明' },
  { value: 'dark', label: '暗' },
]

const ROW = 'min-h-16 flex-row items-center gap-3 px-[18px] py-2.5'

// 設定 from `ST Phone / 設定＋除外シート`: the two sheet entries, 外観, 秒針 and タイムゾーン, sign-out and the footer. Every value is the server's settings row.
export default function SettingsScreen() {
  const { settings, ready, isError, retry } = useSettings()
  const update = useUpdateSettings()
  const activities = useActivities().data ?? []
  const sub = useTokenColor('sub')
  return (
    <Screen>
      <ScreenHeader title="設定" />
      <View className="border-line bg-surface rounded-card border">
        <Link href="/activity-editor" asChild>
          <Pressable aria-label="活動項目" className={ROW}>
            <Text className="text-ink flex-1 text-sm font-semibold">
              活動項目
            </Text>
            <View className="flex-row pl-1">
              {activities.map((activity) => (
                <View
                  key={activity.id}
                  className="border-surface -ml-1 h-3.5 w-3.5 rounded-pill border-2"
                  style={{ backgroundColor: activity.color }}
                />
              ))}
            </View>
            <Text className="text-sub text-xs">{activities.length}項目</Text>
            <Text className="text-sub text-sm">›</Text>
          </Pressable>
        </Link>
        <Link href="/excluded-days" asChild>
          <Pressable
            aria-label="未使用日の自動除外"
            className={cn(ROW, 'border-line border-t')}
          >
            {/* text-sub: on web the icon inherits the colour, and no ancestor here sets one. */}
            <View className="bg-chip text-sub h-7.5 w-7.5 items-center justify-center rounded-chip">
              <StrokeIcon d={INFO} size={16} strokeWidth={1.8} color={sub} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="text-ink text-sm font-semibold">
                未使用日の自動除外
              </Text>
              <Text className="text-sub text-2xs">
                {exclusionSummary(settings, ready)}
              </Text>
            </View>
            <Text className="text-sub text-sm">›</Text>
          </Pressable>
        </Link>
      </View>
      <View className="border-line bg-surface rounded-card border">
        {isError ? (
          <RetryNotice onRetry={retry} />
        ) : (
          <>
            <View className={ROW}>
              <Text className="text-ink flex-1 text-sm font-semibold">
                外観
              </Text>
              <Segmented
                label="外観"
                options={THEME_OPTIONS}
                value={settings.theme}
                disabled={!ready}
                onChange={(theme) => update.mutate({ theme })}
              />
            </View>
            <View className={cn(ROW, 'border-line border-t')}>
              <Text className="text-ink flex-1 text-sm font-semibold">
                秒針を表示
              </Text>
              <Toggle
                label="秒針を表示"
                value={settings.showSecondHand}
                disabled={!ready}
                onChange={(showSecondHand) => update.mutate({ showSecondHand })}
              />
            </View>
            <TimeZoneRow className={cn(ROW, 'border-line border-t')} />
          </>
        )}
      </View>
      <SignOutButton />
      {/* The ST Phone design says 記録はこの端末に保存されます; records live on the account, so both platforms say 自動保存. */}
      <Text className="text-sub mt-auto py-2 text-center text-xs leading-5">
        {Platform.OS === 'web'
          ? 'Switch Time Web 1.0 · 記録は自動保存'
          : 'Switch Time 1.0 · 記録は自動保存'}
      </Text>
    </Screen>
  )
}

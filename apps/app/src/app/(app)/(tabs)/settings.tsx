import type { ThemeMode } from '@switch-time/shared'
import { Link } from 'expo-router'
import { Platform, Pressable, Text, View } from 'react-native'

import { Screen } from '@/components/screen'
import { ScreenHeader } from '@/components/screen-header'
import { Segmented } from '@/components/segmented'
import { StrokeIcon } from '@/components/stroke-icon'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { useActivities } from '@/hooks/use-activities'
import { useSettings, useUpdateSettings } from '@/hooks/use-settings'
import { useSignOut } from '@/hooks/use-sign-out'
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

// 設定 from `ST Phone / 設定＋除外シート`: the two sheet entries, 外観 and 秒針, sign-out and the footer. Every value is the server's settings row.
export default function SettingsScreen() {
  const { settings } = useSettings()
  const update = useUpdateSettings()
  const activities = useActivities().data ?? []
  const signOut = useSignOut()
  const sub = useTokenColor('sub')
  return (
    <Screen>
      <ScreenHeader title="設定" />
      <View className="rounded-card border border-line bg-surface">
        <Link href="/activity-editor" asChild>
          <Pressable aria-label="活動項目" className={ROW}>
            <Text className="flex-1 text-sm font-semibold text-ink">
              活動項目
            </Text>
            <View className="flex-row pl-1">
              {activities.map((activity) => (
                <View
                  key={activity.id}
                  className="-ml-1 h-3.5 w-3.5 rounded-pill border-2 border-surface"
                  style={{ backgroundColor: activity.color }}
                />
              ))}
            </View>
            <Text className="text-xs text-sub">{activities.length}項目</Text>
            <Text className="text-sm text-sub">›</Text>
          </Pressable>
        </Link>
        <Link href="/excluded-days" asChild>
          <Pressable
            aria-label="未使用日の自動除外"
            className={cn(ROW, 'border-t border-line')}
          >
            <View className="h-[30px] w-[30px] items-center justify-center rounded-chip bg-chip">
              <StrokeIcon d={INFO} size={16} strokeWidth={1.8} color={sub} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-semibold text-ink">
                未使用日の自動除外
              </Text>
              <Text className="text-2xs text-sub">
                {exclusionSummary(settings)}
              </Text>
            </View>
            <Text className="text-sm text-sub">›</Text>
          </Pressable>
        </Link>
      </View>
      <View className="rounded-card border border-line bg-surface">
        <View className={ROW}>
          <Text className="flex-1 text-sm font-semibold text-ink">外観</Text>
          <Segmented
            label="外観"
            options={THEME_OPTIONS}
            value={settings.theme}
            onChange={(theme) => update.mutate({ theme })}
          />
        </View>
        <View className={cn(ROW, 'border-t border-line')}>
          <Text className="flex-1 text-sm font-semibold text-ink">
            秒針を表示
          </Text>
          <Toggle
            label="秒針を表示"
            value={settings.showSecondHand}
            onChange={(showSecondHand) => update.mutate({ showSecondHand })}
          />
        </View>
      </View>
      <Button
        title="サインアウト"
        variant="ghost"
        onPress={() => void signOut()}
      />
      <Text className="mt-auto py-2 text-center text-xs leading-5 text-sub">
        {Platform.OS === 'web'
          ? 'Switch Time Web 1.0 · 記録は自動保存'
          : 'Switch Time 1.0 · 記録はこの端末に保存されます'}
      </Text>
    </Screen>
  )
}

import type { ThemeMode } from '@switch-time/shared'
import { Platform, Pressable, Text, View } from 'react-native'

import { Screen } from '@/components/screen'
import { ScreenHeader } from '@/components/screen-header'
import { Button } from '@/components/ui/button'
import { useSignOut } from '@/hooks/use-sign-out'
import { cn } from '@/lib/utils'
import { useAppDispatch, useAppSelector } from '@/store'
import { preferencesSlice } from '@/store/preferences'

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'auto', label: '自動' },
  { value: 'light', label: '明' },
  { value: 'dark', label: '暗' },
]

// 外観 and サインアウト live here already; the rest of the settings body lands with MVP-16.
export default function SettingsScreen() {
  const theme = useAppSelector((s) => s.preferences.theme)
  const dispatch = useAppDispatch()
  const signOut = useSignOut()
  return (
    <Screen>
      <ScreenHeader title="設定" />
      <View className="min-h-16 flex-row items-center gap-3 rounded-card border border-line bg-surface px-[18px] py-2.5">
        <Text className="flex-1 text-sm font-semibold text-ink">外観</Text>
        <View
          role="radiogroup"
          className="flex-row gap-[3px] rounded-chip bg-chip p-[3px]"
        >
          {THEME_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              role="radio"
              aria-checked={theme === option.value}
              className={cn(
                'h-8 min-w-14 items-center justify-center rounded-chip px-3',
                theme === option.value && 'bg-surface',
              )}
              onPress={() =>
                dispatch(preferencesSlice.actions.setTheme(option.value))
              }
            >
              <Text
                className={cn(
                  'text-xs font-semibold',
                  theme === option.value ? 'text-ink' : 'text-sub',
                )}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
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

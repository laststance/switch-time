import { ScrollView, Text, View } from 'react-native'

import { Control } from '@/components/control'
import { RetryNotice } from '@/components/retry-notice'
import { Segmented } from '@/components/segmented'
import { Sheet } from '@/components/sheet'
import { Toggle } from '@/components/ui/toggle'
import { useExcludedDays } from '@/hooks/use-excluded-days'
import { useSettings, useUpdateSettings } from '@/hooks/use-settings'
import { formatDay } from '@/lib/format'
import { IDLE_OPTIONS, idleLabel } from '@/lib/settings'

// Why a day is out of the averages; `excludedDays.list` only stores manual rows, `auto_unused` days are computed by stats.
const REASONS = { manual: '手動で除外', auto_unused: '切替なし' } as const

/** The 未使用日の扱い sheet from `ST Phone / 設定＋除外シート`: the rule, the idle threshold and the days to bring back. */
export default function ExcludedDaysSheet() {
  const { settings, ready, isError, retry } = useSettings()
  const update = useUpdateSettings()
  const excluded = useExcludedDays()
  return (
    <Sheet
      title="未使用日の扱い"
      hint="一度も切り替えなかった日は「計測なし」として平均・連続記録から外します。"
    >
      {/* Both cards read the same settings row: a failed read would show the defaults as if they were the account's own. */}
      {isError ? (
        <RetryNotice onRetry={retry} />
      ) : (
        <>
          <View className="flex-row items-center gap-3 rounded-card bg-chip px-4 py-3.5">
            <Text className="flex-1 text-sm font-semibold text-ink">
              自動で除外する
            </Text>
            <Toggle
              label="自動で除外する"
              value={settings.autoExcludeUnusedDays}
              disabled={!ready}
              onChange={(autoExcludeUnusedDays) =>
                update.mutate({ autoExcludeUnusedDays })
              }
            />
          </View>
          <View className="gap-3 rounded-card bg-chip px-4 py-3.5">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-ink">
                無操作とみなす時間
              </Text>
              <Text className="text-md font-semibold text-ink tabular">
                {idleLabel(settings.idleThresholdMinutes)}
              </Text>
            </View>
            <Segmented
              grow
              label="無操作とみなす時間"
              options={IDLE_OPTIONS}
              value={settings.idleThresholdMinutes}
              disabled={!ready}
              onChange={(idleThresholdMinutes) =>
                update.mutate({ idleThresholdMinutes })
              }
            />
            <Text className="text-2xs leading-4 text-sub">
              これより長く同じ状態のまま操作がなければ、その時間は集計に含めません。
            </Text>
          </View>
        </>
      )}
      <Text className="text-xs text-sub">除外中の日（タップで戻す）</Text>
      {excluded.isError ? (
        <RetryNotice onRetry={excluded.retry} />
      ) : (
        <ScrollView className="shrink" contentContainerClassName="gap-2">
          {excluded.rows.map((row) => (
            <Control
              key={row.day}
              label={`${formatDay(row.day)}を戻す`}
              disabled={excluded.pending}
              onPress={() => excluded.include(row.day)}
              className="h-[52px] flex-row gap-3 rounded-card border border-line px-4"
            >
              <Text className="flex-1 text-sm font-semibold text-ink">
                {formatDay(row.day)}
              </Text>
              <Text className="text-xs text-sub">{REASONS[row.reason]}</Text>
              <Text className="text-xs font-semibold text-accent">戻す</Text>
            </Control>
          ))}
          {excluded.empty && (
            <Text className="py-3 text-center text-xs text-sub">
              除外中の日はありません
            </Text>
          )}
        </ScrollView>
      )}
    </Sheet>
  )
}

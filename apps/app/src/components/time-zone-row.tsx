import { Text, View } from 'react-native'

import { Control } from '@/components/control'
import { useAccountZone } from '@/hooks/use-account-zone'

/**
 * 設定's タイムゾーン row (`ST Phone / 設定・タイムゾーン行の状態`): the account's zone against this device's, and 「この端末に合わせる」
 * when another device set it. A failed take-back swaps the sub line for an alert. Rendered last in 設定's 外観 card.
 * @param className - The screen's row layout.
 * @example <TimeZoneRow className={cn(ROW, 'border-line border-t')} />
 */
export function TimeZoneRow({ className }: { className: string }) {
  const { summary, alert, canTakeBack, busy, takeBack } = useAccountZone()
  return (
    <View className={className}>
      <View className="flex-1 gap-0.5">
        <Text className="text-ink text-sm font-semibold">タイムゾーン</Text>
        {/* Keyed apart, so the alert mounts as a fresh node and is announced rather than read as the old line's new text. */}
        {alert ? (
          <Text
            key="alert"
            role="alert"
            className="text-ink text-2xs font-medium"
          >
            {summary}
          </Text>
        ) : (
          <Text key="summary" className="text-sub text-2xs">
            {summary}
          </Text>
        )}
      </View>
      {canTakeBack ? (
        <Control
          disabled={busy}
          onPress={takeBack}
          className="border-line h-11 shrink-0 rounded-chip border px-3"
        >
          <Text className="text-ink text-xs font-semibold">
            この端末に合わせる
          </Text>
        </Control>
      ) : null}
    </View>
  )
}

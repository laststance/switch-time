import { Pressable, Text, View } from 'react-native'

/**
 * What a screen shows when its queries failed: one line and a 再読み込み button, instead of an empty frame that never resolves.
 * @example <RetryNotice onRetry={retry} />
 */
export function RetryNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="items-center gap-3 py-10">
      <Text className="text-sm text-sub">読み込めませんでした</Text>
      <Pressable
        role="button"
        onPress={onRetry}
        className="h-11 items-center justify-center rounded-pill border border-line bg-surface px-5"
      >
        <Text className="text-xs font-semibold text-ink">再読み込み</Text>
      </Pressable>
    </View>
  )
}

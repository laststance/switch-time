import { Pressable, Text, View } from 'react-native'

/**
 * What a screen shows when its queries failed: one line and a 再読み込み button, instead of an empty frame that never resolves.
 * @example <RetryNotice onRetry={retry} />
 */
export function RetryNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="items-center gap-3 py-10">
      <Text className="text-sub text-sm">読み込めませんでした</Text>
      <Pressable
        role="button"
        onPress={onRetry}
        className="border-line bg-surface h-11 items-center justify-center rounded-pill border px-5"
      >
        <Text className="text-ink text-xs font-semibold">再読み込み</Text>
      </Pressable>
    </View>
  )
}

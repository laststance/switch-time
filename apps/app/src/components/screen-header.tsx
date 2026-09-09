import { Text, View } from 'react-native'

/**
 * Screen title row from the design: 22 px bold heading, optional 15 px `aside` (the date on ホーム) on the same baseline.
 * @example <ScreenHeader title="いま" aside="9月9日（水）" />
 */
export function ScreenHeader({
  title,
  aside,
}: {
  title: string
  aside?: string
}) {
  return (
    <View className="min-h-9 flex-row items-baseline justify-between">
      <Text
        role="heading"
        aria-level={1}
        className="text-lg font-bold tracking-tight text-ink"
      >
        {title}
      </Text>
      {aside && <Text className="text-sm font-medium text-sub">{aside}</Text>}
    </View>
  )
}

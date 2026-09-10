import type { PropsWithChildren } from 'react'
import { Text, View } from 'react-native'

type ScreenHeaderProps = PropsWithChildren<{
  title: string
  aside?: string
}>

/**
 * Screen title row from the design: 22 px bold heading, optional 15 px `aside` (the date on ホーム) and any control (the 訂正 pill) on the right.
 * @example <ScreenHeader title="いま" aside="9月9日（水）"><CorrectionLink /></ScreenHeader>
 */
export function ScreenHeader({ title, aside, children }: ScreenHeaderProps) {
  return (
    <View className="min-h-9 flex-row items-center justify-between">
      <Text
        role="heading"
        aria-level={1}
        className="text-lg font-bold tracking-tight text-ink"
      >
        {title}
      </Text>
      <View className="flex-row items-center gap-3">
        {aside && <Text className="text-sm font-medium text-sub">{aside}</Text>}
        {children}
      </View>
    </View>
  )
}

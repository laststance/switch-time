import { Link } from 'expo-router'
import { Text, View } from 'react-native'

// Unknown web URL or bad deep link: the message plus the way home.
export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg p-6">
      <Text className="text-lg font-bold text-ink">ページが見つかりません</Text>
      <Link href="/">
        <Text className="text-sm text-accent">ホームへ戻る</Text>
      </Link>
    </View>
  )
}

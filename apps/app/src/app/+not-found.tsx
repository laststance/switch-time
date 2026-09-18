import { Link } from 'expo-router'
import { Text, View } from 'react-native'

// Unknown web URL or bad deep link: the message plus the way home.
export default function NotFoundScreen() {
  return (
    <View className="bg-bg flex-1 items-center justify-center gap-4 p-6">
      <Text className="text-ink text-lg font-bold">ページが見つかりません</Text>
      <Link href="/">
        <Text className="text-accent text-sm">ホームへ戻る</Text>
      </Link>
    </View>
  )
}

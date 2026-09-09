import { Text, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { useSignOut } from '@/hooks/use-sign-out'

/**
 * The サインアウト button with its own pending and error state, so every screen that offers it reports a failed sign-out the same way.
 * @example <SignOutButton />
 */
export function SignOutButton() {
  const signOut = useSignOut()
  return (
    <View className="gap-2">
      <Button
        title="サインアウト"
        variant="ghost"
        onPress={() => signOut.mutate()}
        disabled={signOut.isPending}
      />
      {signOut.error ? (
        <Text role="alert" className="text-center text-xs text-ink">
          {signOut.error.message}
        </Text>
      ) : null}
    </View>
  )
}

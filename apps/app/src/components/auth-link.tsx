import { type Href, Link } from 'expo-router'
import { Pressable, Text } from 'react-native'

import { useAuthConfig } from '@/hooks/use-auth-config'
import { FOCUS_RING, pressLook } from '@/lib/press'
import { cn } from '@/lib/utils'

/**
 * The small accent link under an auth card's button (新規登録はこちら, サインインに戻る, …).
 * @param href - Where it goes.
 * @param label - Its text, also its accessible name.
 * @example <AuthLink href="/sign-in" label="サインインに戻る" />
 */
export function AuthLink({ href, label }: { href: Href; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable
        role="link"
        className={cn(FOCUS_RING, pressLook(false), 'items-center py-2')}
      >
        <Text className="text-accent text-xs">{label}</Text>
      </Pressable>
    </Link>
  )
}

/**
 * Sign-in's 「パスワードを忘れた方」: shown only where the API has a mail server to send the reset link ({@link useAuthConfig}).
 * @example <ForgotPasswordLink />
 */
export function ForgotPasswordLink() {
  const { emailVerification } = useAuthConfig()
  return emailVerification ? (
    <AuthLink href="/forgot-password" label="パスワードを忘れた方" />
  ) : null
}

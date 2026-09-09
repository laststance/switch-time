import { signInSchema } from '@switch-time/shared'
import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, Text } from 'react-native'

import { AuthCard } from '@/components/auth-card'
import { CredentialFields } from '@/components/credential-fields'
import { Button } from '@/components/ui/button'
import { nextHref, useAuthForm } from '@/hooks/use-auth-form'
import { authClient } from '@/lib/auth-client'

export default function SignInScreen() {
  const router = useRouter()
  const { next } = useLocalSearchParams<{ next?: string }>()
  const form = useAuthForm(
    signInSchema,
    { email: '', password: '' },
    async (values) => authClient.signIn.email(values),
    () => router.replace(nextHref(next)),
  )

  return (
    <AuthCard title="サインイン" error={form.serverError}>
      <CredentialFields
        values={form.values}
        errors={form.fieldErrors}
        set={form.set}
        newPassword={false}
      />
      <Button
        title="サインイン"
        disabled={form.pending}
        onPress={() => void form.onSubmit()}
      />
      <Link
        href={{ pathname: '/sign-up', params: next ? { next } : {} }}
        asChild
      >
        <Pressable role="link" className="items-center py-2">
          <Text className="text-xs text-accent">新規登録はこちら</Text>
        </Pressable>
      </Link>
    </AuthCard>
  )
}

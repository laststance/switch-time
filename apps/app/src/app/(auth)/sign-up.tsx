import { signUpSchema } from '@switch-time/shared'
import { Link, useLocalSearchParams } from 'expo-router'
import { Pressable, Text } from 'react-native'

import { AuthCard, Field } from '@/components/auth-card'
import { CredentialFields } from '@/components/credential-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthForm } from '@/hooks/use-auth-form'
import { authClient } from '@/lib/auth-client'

export default function SignUpScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>()
  // Better Auth signs the new user in right away (autoSignIn); the (auth) layout then follows `next` into the app.
  const form = useAuthForm(
    signUpSchema,
    { name: '', email: '', password: '' },
    async (values) => authClient.signUp.email(values),
  )

  return (
    <AuthCard title="アカウントを作成" error={form.serverError}>
      <Field label="名前" error={form.fieldErrors.name}>
        <Input
          aria-label="名前"
          autoComplete="name"
          value={form.values.name}
          onChangeText={form.set('name')}
        />
      </Field>
      <CredentialFields
        values={form.values}
        errors={form.fieldErrors}
        set={form.set}
        newPassword
      />
      <Button
        title="アカウントを作成"
        disabled={form.pending}
        onPress={() => void form.onSubmit()}
      />
      <Link
        href={{ pathname: '/sign-in', params: next ? { next } : {} }}
        asChild
      >
        <Pressable role="link" className="items-center py-2">
          <Text className="text-xs text-accent">サインインはこちら</Text>
        </Pressable>
      </Link>
    </AuthCard>
  )
}

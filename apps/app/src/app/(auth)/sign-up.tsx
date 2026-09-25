import { signUpSchema } from '@switch-time/shared'
import { Link, useLocalSearchParams } from 'expo-router'
import { Pressable, Text } from 'react-native'

import { AuthCard, Field } from '@/components/auth-card'
import { CredentialFields } from '@/components/credential-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthForm } from '@/hooks/use-auth-form'
import { useRegistration } from '@/hooks/use-registration'
import { authClient } from '@/lib/auth-client'

export default function SignUpScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>()
  const { register } = useRegistration()
  // Sign-up opens no session (`autoSignIn: false`, so an address that already has an account gets the same answer):
  // `register` ({@link useRegistration}) moves on to sign-in with the address filled in, keeping `next`, which the (auth) layout
  // follows once that sign-in lands.
  const form = useAuthForm(
    signUpSchema,
    { name: '', email: '', password: '' },
    async (values) => authClient.signUp.email(values),
    (values) => register(values.email),
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
        onPress={form.onSubmit}
      />
      <Link
        href={{ pathname: '/sign-in', params: next ? { next } : {} }}
        asChild
      >
        <Pressable role="link" className="items-center py-2">
          <Text className="text-accent text-xs">サインインはこちら</Text>
        </Pressable>
      </Link>
    </AuthCard>
  )
}

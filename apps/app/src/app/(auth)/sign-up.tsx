import { signUpSchema } from '@switch-time/shared'
import { useLocalSearchParams } from 'expo-router'

import { AuthCard, Field } from '@/components/auth-card'
import { AuthLink } from '@/components/auth-link'
import { CredentialFields } from '@/components/credential-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthForm } from '@/hooks/use-auth-form'
import { useRegistration } from '@/hooks/use-registration'
import { authClient } from '@/lib/auth-client'
import {
  cachedEmailVerification,
  loadEmailVerification,
} from '@/lib/auth-config'
import { confirmationLandingUrl } from '@/lib/auth-links'
import { API_ORIGIN } from '@/lib/env'
import { queryClient } from '@/lib/query'

export default function SignUpScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>()
  const { register } = useRegistration()
  // Sign-up opens no session (`autoSignIn: false`, so an address that already has an account gets the same answer):
  // `register` ({@link useRegistration}) moves on to sign-in with the address filled in, keeping `next`, which the (auth) layout
  // follows once that sign-in lands. With a mail server the mailed link is what confirms the address, and it lands on sign-in;
  // the request waits for the API's answer about mail first, so the notice is never chosen by a config that was still loading.
  const form = useAuthForm(
    signUpSchema,
    { name: '', email: '', password: '' },
    async (values) => {
      await loadEmailVerification(queryClient, API_ORIGIN)
      return authClient.signUp.email({
        ...values,
        callbackURL: confirmationLandingUrl(),
      })
    },
    (values) => register(values.email, cachedEmailVerification(queryClient)),
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
      <AuthLink
        href={{ pathname: '/sign-in', params: next ? { next } : {} }}
        label="サインインはこちら"
      />
    </AuthCard>
  )
}

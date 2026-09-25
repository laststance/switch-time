import { signInSchema } from '@switch-time/shared'
import { Link, useLocalSearchParams } from 'expo-router'
import { Pressable, Text } from 'react-native'

import { AUTH_NOTICE_ID, AuthCard } from '@/components/auth-card'
import { CredentialFields } from '@/components/credential-fields'
import { Button } from '@/components/ui/button'
import { useAuthForm } from '@/hooks/use-auth-form'
import {
  useNativeAnnouncement,
  useRegistration,
} from '@/hooks/use-registration'
import { authClient } from '@/lib/auth-client'
import { type SignInStart, signInStart } from '@/lib/sign-in'

export default function SignInScreen() {
  const { registration, dismissNotice } = useRegistration()
  const start = signInStart(registration)
  // A new registration remounts the form with its address; dismissing the notice keeps the typed text.
  return (
    <SignInForm key={start.key} start={start} dismissNotice={dismissNotice} />
  )
}

type SignInFormProps = {
  start: SignInStart
  dismissNotice: () => void
}

function SignInForm({ start, dismissNotice }: SignInFormProps) {
  // `next` only travels on to sign-up here; the (auth) layout follows it once the session lands.
  const { next } = useLocalSearchParams<{ next?: string }>()
  const form = useAuthForm(
    signInSchema,
    { email: start.email, password: '' },
    async (values) => authClient.signIn.email(values),
  )
  // Native screen readers stay where they were when the screen changes: say it once. Web reads it with the focused password field.
  useNativeAnnouncement(start.notice)

  const set =
    (key: 'email' | 'password') =>
    (text: string): void => {
      dismissNotice()
      form.set(key)(text)
    }
  const onSubmit = (): void => {
    dismissNotice()
    form.onSubmit()
  }

  return (
    <AuthCard title="サインイン" error={form.serverError} notice={start.notice}>
      <CredentialFields
        values={form.values}
        errors={form.fieldErrors}
        set={set}
        newPassword={false}
        focusPassword={start.focusPassword}
        passwordDescribedBy={start.notice ? AUTH_NOTICE_ID : undefined}
      />
      <Button title="サインイン" disabled={form.pending} onPress={onSubmit} />
      <Link
        href={{ pathname: '/sign-up', params: next ? { next } : {} }}
        asChild
      >
        <Pressable role="link" className="items-center py-2">
          <Text className="text-accent text-xs">新規登録はこちら</Text>
        </Pressable>
      </Link>
    </AuthCard>
  )
}

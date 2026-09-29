import { signInSchema } from '@switch-time/shared'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'

import { AUTH_NOTICE_ID, AuthCard } from '@/components/auth-card'
import { AuthLink, ForgotPasswordLink } from '@/components/auth-link'
import { CredentialFields } from '@/components/credential-fields'
import { Button } from '@/components/ui/button'
import { useAuthForm } from '@/hooks/use-auth-form'
import { useLatchedFlag } from '@/hooks/use-latched-flag'
import {
  useNativeAnnouncement,
  useRegistration,
} from '@/hooks/use-registration'
import { useScreenFocusField } from '@/hooks/use-screen-focus-field'
import { authClient } from '@/lib/auth-client'
import { startTapSession } from '@/lib/optimistic-switch'
import { queryClient } from '@/lib/query'
import {
  keptFormKey,
  signInArrival,
  type SignInStart,
  signInBusy,
  signInError,
  signInStart,
} from '@/lib/sign-in'
import { resetApp, useAppDispatch } from '@/store'

export default function SignInScreen() {
  const { registration, dismissNotice } = useRegistration()
  // A mailed link (or a finished reset) ends here with a query that says which.
  const { verified, reset, error } = useLocalSearchParams<{
    verified?: string
    reset?: string
    error?: string
  }>()
  const start = signInStart(
    registration,
    signInArrival({ verified, reset, error }),
  )
  // A new registration remounts the form with its address; dismissing the notice, or sign-in's own reset, keeps the typed text.
  const [formKey, setFormKey] = useState(start.key)
  const nextKey = keptFormKey(formKey, start.key)
  if (nextKey !== formKey) setFormKey(nextKey)
  return (
    <SignInForm key={nextKey} start={start} dismissNotice={dismissNotice} />
  )
}

type SignInFormProps = {
  start: SignInStart
  dismissNotice: () => void
}

function SignInForm({ start, dismissNotice }: SignInFormProps) {
  // `next` only travels on to sign-up here; the (auth) layout follows it once the session lands.
  const { next } = useLocalSearchParams<{ next?: string }>()
  const dispatch = useAppDispatch()
  // A new session must not inherit the previous account's cache (shared device; gcTime keeps it for minutes), nor its undo slots:
  // a session that expired or was revoked elsewhere reaches sign-in without sign-out's reset. The reset also draws a new epoch,
  // so an edit of the old session that lands late is ignored. The (auth) layout leaves sign-in once the session has landed.
  const form = useAuthForm(
    signInSchema,
    { email: start.email, password: '' },
    async (values) => authClient.signIn.email(values),
    () => {
      queryClient.clear()
      startTapSession(queryClient)
      dispatch(resetApp())
    },
  )
  // Native screen readers stay where they were when the screen changes: say it once. Web reads it with the focused password field.
  useNativeAnnouncement(start.notice)
  const passwordRef = useScreenFocusField(start.focusPassword)
  const { isPending: sessionPending } = authClient.useSession()
  // Better Auth starts the session reload a moment after the request answers: until it has started, the session is not loading yet.
  const reloadStarted = useLatchedFlag(form.succeeded && sessionPending)

  // The notice is about the address just registered: it stays through the password and a failed try (the error takes its box, so
  // the card does not move), and goes when the address is edited.
  const set =
    (key: 'email' | 'password') =>
    (text: string): void => {
      if (key === 'email') dismissNotice()
      form.set(key)(text)
    }

  return (
    <AuthCard
      title="サインイン"
      error={signInError(form.serverError, start)}
      notice={start.notice}
    >
      <CredentialFields
        values={form.values}
        errors={form.fieldErrors}
        set={set}
        newPassword={false}
        passwordRef={passwordRef}
        passwordDescribedBy={start.notice ? AUTH_NOTICE_ID : undefined}
      />
      <Button
        title="サインイン"
        disabled={signInBusy(form, {
          pending: sessionPending,
          reloadStarted,
        })}
        onPress={form.onSubmit}
      />
      <ForgotPasswordLink />
      <AuthLink
        href={{ pathname: '/sign-up', params: next ? { next } : {} }}
        label="新規登録はこちら"
      />
    </AuthCard>
  )
}

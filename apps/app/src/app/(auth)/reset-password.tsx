import { resetPasswordSchema } from '@switch-time/shared'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { AuthCard, Field } from '@/components/auth-card'
import { AuthLink } from '@/components/auth-link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthForm } from '@/hooks/use-auth-form'
import { authClient } from '@/lib/auth-client'
import { RESET_LINK_EXPIRED, resetScreenError } from '@/lib/auth-errors'

/**
 * Chooses the new password, from the link in the reset mail (`?token=…`; `?error=…` when Better Auth found the link spoiled or
 * used). A finished reset moves on to sign-in with a notice; the API ends the other sessions of the account. A link that is
 * old or broken says so and offers to ask again. Drawn after the pen board 「ST Phone / メール確認とパスワード再設定」.
 */
export default function ResetPasswordScreen() {
  const { token, error: linkError } = useLocalSearchParams<{
    token?: string
    error?: string
  }>()
  const router = useRouter()
  const form = useAuthForm(
    resetPasswordSchema,
    { password: '' },
    async (values) =>
      authClient.resetPassword({
        newPassword: values.password,
        token: token ?? '',
      }),
    () => router.replace({ pathname: '/sign-in', params: { reset: '1' } }),
  )
  const error = resetScreenError(form.serverError, token, linkError)

  return (
    <AuthCard title="新しいパスワード" error={error}>
      <Field label="パスワード" error={form.fieldErrors.password}>
        <Input
          aria-label="パスワード"
          autoComplete="new-password"
          secureTextEntry
          value={form.values.password}
          onChangeText={form.set('password')}
        />
      </Field>
      <Button
        title="パスワードを変える"
        disabled={form.pending}
        onPress={form.onSubmit}
      />
      {/* An old link cannot be used again: the way forward is a new mail. */}
      {error === RESET_LINK_EXPIRED ? (
        <AuthLink href="/forgot-password" label="再設定のメールを送る" />
      ) : null}
    </AuthCard>
  )
}

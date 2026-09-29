import { forgotPasswordSchema } from '@switch-time/shared'
import { useState } from 'react'

import { AuthCard, Field } from '@/components/auth-card'
import { AuthLink } from '@/components/auth-link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthForm } from '@/hooks/use-auth-form'
import { useNativeAnnouncement } from '@/hooks/use-registration'
import { authClient } from '@/lib/auth-client'
import { resetLandingUrl } from '@/lib/auth-links'

// The same words whether or not the address has an account, so the answer does not tell who has one.
const SENT_NOTICE =
  '登録があれば、再設定のメールを送りました。届かないときは迷惑メールも見てください'

/**
 * Asks for a password-reset mail: the address only. Reached from sign-in's 「パスワードを忘れた方」, which shows only when the API
 * has a mail server. Drawn after the pen board 「ST Phone / メール確認とパスワード再設定」.
 */
export default function ForgotPasswordScreen() {
  const [sent, setSent] = useState(false)
  const form = useAuthForm(
    forgotPasswordSchema,
    { email: '' },
    async (values) =>
      authClient.requestPasswordReset({
        ...values,
        redirectTo: resetLandingUrl(),
      }),
    () => setSent(true),
  )
  // Native screen readers stay where they were when the text appears: say it once. Web reads the status line itself.
  useNativeAnnouncement(sent ? SENT_NOTICE : null)

  return (
    <AuthCard
      title="パスワードを忘れたとき"
      error={form.serverError}
      notice={sent ? SENT_NOTICE : null}
    >
      <Field label="メールアドレス" error={form.fieldErrors.email}>
        <Input
          aria-label="メールアドレス"
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
          value={form.values.email}
          onChangeText={form.set('email')}
        />
      </Field>
      <Button
        title="再設定のメールを送る"
        disabled={form.pending}
        onPress={form.onSubmit}
      />
      <AuthLink href="/sign-in" label="サインインに戻る" />
    </AuthCard>
  )
}

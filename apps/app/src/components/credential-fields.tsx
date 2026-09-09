import { Field } from '@/components/auth-card'
import { Input } from '@/components/ui/input'

type CredentialFieldsProps = {
  values: { email: string; password: string }
  errors: { email?: string; password?: string }
  set: (key: 'email' | 'password') => (text: string) => void
  // Switches the browser / keychain autofill hint between a saved and a fresh password.
  newPassword: boolean
}

/**
 * Email + password pair shared by the sign-in and sign-up screens, wired to a {@link useAuthForm} instance.
 * @example <CredentialFields values={form.values} errors={form.fieldErrors} set={form.set} newPassword />
 */
export function CredentialFields({
  values,
  errors,
  set,
  newPassword,
}: CredentialFieldsProps) {
  return (
    <>
      <Field label="メールアドレス" error={errors.email}>
        <Input
          aria-label="メールアドレス"
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChangeText={set('email')}
        />
      </Field>
      <Field label="パスワード" error={errors.password}>
        <Input
          aria-label="パスワード"
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          secureTextEntry
          value={values.password}
          onChangeText={set('password')}
        />
      </Field>
    </>
  )
}

import { Platform } from 'react-native'

import { Field } from '@/components/auth-card'
import { Input } from '@/components/ui/input'

type CredentialFieldsProps = {
  values: { email: string; password: string }
  errors: { email?: string; password?: string }
  set: (key: 'email' | 'password') => (text: string) => void
  // Switches the browser / keychain autofill hint between a saved and a fresh password.
  newPassword: boolean
  // Sign-in after sign-up: the address is filled in, so the password takes the focus.
  focusPassword?: boolean
  // Id of the text that describes the password field (the 登録しました notice), so a screen reader reads it with the focused field.
  passwordDescribedBy?: string
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
  focusPassword = false,
  passwordDescribedBy,
}: CredentialFieldsProps) {
  // react-native-web passes aria-describedby to the <input>; React Native's types have no such prop (native announces instead).
  const description =
    Platform.OS === 'web' && passwordDescribedBy
      ? { 'aria-describedby': passwordDescribedBy }
      : {}
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
          autoFocus={focusPassword}
          secureTextEntry
          value={values.password}
          onChangeText={set('password')}
          {...description}
        />
      </Field>
    </>
  )
}

import type { PropsWithChildren } from 'react'
import { Text, View } from 'react-native'

import { Label } from '@/components/ui/label'

type AuthCardProps = PropsWithChildren<{ title: string; error: string | null }>

/**
 * Centered card shared by the sign-in and sign-up screens: title, one server error line, then the fields.
 * The .pen has no auth frame yet, so this stays on tokens only (bg / surface / ink / sub / accent, radius 16).
 * @example <AuthCard title="サインイン" error={form.serverError}>{fields}</AuthCard>
 */
export function AuthCard({ title, error, children }: AuthCardProps) {
  return (
    <View className="flex-1 items-center justify-center bg-bg p-5">
      <View className="w-full max-w-sm gap-4 rounded-card border border-line bg-surface p-6">
        <Text className="text-xl font-semibold text-ink">{title}</Text>
        {error ? (
          <View className="rounded-chip bg-chip px-3 py-2">
            <Text role="alert" className="text-xs text-ink">
              {error}
            </Text>
          </View>
        ) : null}
        {children}
      </View>
    </View>
  )
}

type FieldProps = PropsWithChildren<{
  label: string
  error: string | undefined
}>

/**
 * {@link Label} + control + the field's first validation message.
 * @example <Field label="パスワード" error={form.fieldErrors.password}><Input … /></Field>
 */
export function Field({ label, error, children }: FieldProps) {
  return (
    <View className="gap-1">
      <Label>{label}</Label>
      {children}
      {error ? <Text className="text-xs text-ink">{error}</Text> : null}
    </View>
  )
}

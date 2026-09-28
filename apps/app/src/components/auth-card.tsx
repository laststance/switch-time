import type { PropsWithChildren } from 'react'
import { KeyboardAvoidingView, ScrollView, Text, View } from 'react-native'

import { Label } from '@/components/ui/label'

/** Id of the notice line, for the field it describes ({@link CredentialFields}' `passwordDescribedBy`). */
export const AUTH_NOTICE_ID = 'auth-notice'

type AuthCardProps = PropsWithChildren<{
  title: string
  error: string | null
  notice?: string | null
}>

/**
 * Centered card shared by the sign-in and sign-up screens: title, one line in the chip box, then the fields.
 * The line is the server error (role=alert) or, when there is none, a notice (role=status) such as sign-in's 登録しました.
 * Drawn after the .pen boards 「ST Phone / サインイン（登録後）」 and 「ST Phone / サインイン・キーボード表示中」, on tokens only
 * (bg / surface / ink / chip, radius 16). With the keyboard open the card sits in the area above it and scrolls when it does not
 * fit, so the focused field and the button stay in view (the web build has no on-screen keyboard: the view is a plain box there).
 * @example <AuthCard title="サインイン" error={form.serverError} notice={null}>{fields}</AuthCard>
 */
export function AuthCard({
  title,
  error,
  notice = null,
  children,
}: AuthCardProps) {
  return (
    <KeyboardAvoidingView behavior="padding" className="bg-bg flex-1">
      {/* `grow` keeps the card centred while it fits; `handled` lets a tap on the button through while a field has the focus. */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="grow items-center justify-center p-5"
      >
        <View className="border-line bg-surface w-full max-w-sm gap-4 rounded-card border p-6">
          <Text className="text-ink text-xl font-semibold">{title}</Text>
          {/* An error replaces the notice: one line, one box. */}
          {error ? (
            <View className="bg-chip rounded-chip px-3 py-2">
              <Text role="alert" className="text-ink text-xs">
                {error}
              </Text>
            </View>
          ) : notice ? (
            <View className="bg-chip rounded-chip px-3 py-2">
              <Text
                role="status"
                nativeID={AUTH_NOTICE_ID}
                className="text-ink text-xs"
              >
                {notice}
              </Text>
            </View>
          ) : null}
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
      {error ? <Text className="text-ink text-xs">{error}</Text> : null}
    </View>
  )
}

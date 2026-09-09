import { z } from 'zod'

import { ACTIVITY_PALETTE } from './activity-palette'

/** Accepts only the 8 design palette hexes; keeps the DB free of arbitrary colours. */
export const activityColorSchema = z.enum(ACTIVITY_PALETTE)

/** Switch-button label; short so it fits the 2x3 grid on mobile. */
export const activityNameSchema = z.string().trim().min(1).max(20)

/** Daily target in hours; `null` means "no target" (no ring/target line). */
export const targetHoursSchema = z.number().min(0).max(24).nullable()

/** Theme setting persisted per user (Settings > Appearance). */
export const themeModeSchema = z.enum(['auto', 'light', 'dark'])
export type ThemeMode = z.infer<typeof themeModeSchema>

/**
 * Payload for creating/renaming an activity from the Activity editor sheet.
 * Shared by the oRPC `activities.*` router (MVP-12) and the RNR form (MVP-17).
 * @example
 * activityInputSchema.parse({ name: '読書', color: '#2BA3B5', iconKey: 'book', targetHours: 1 })
 */
export const activityInputSchema = z.object({
  name: activityNameSchema,
  color: activityColorSchema,
  iconKey: z.string().min(1).max(32),
  targetHours: targetHoursSchema,
})
export type ActivityInput = z.infer<typeof activityInputSchema>

/** Better Auth's password bounds (8–128), checked client-side first so the error is inline and instant. */
export const passwordSchema = z
  .string()
  .min(8, { error: 'パスワードは8文字以上にしてください' })
  .max(128, { error: 'パスワードは128文字以内にしてください' })

/**
 * Sign-in form payload; {@link signUpSchema} extends it with the display name.
 * @example signInSchema.safeParse({ email: 'a@b.co', password: 'hunter22' }).success // true
 */
export const signInSchema = z.object({
  email: z.email({ error: 'メールアドレスの形式が正しくありません' }),
  password: passwordSchema,
})
export type SignInInput = z.infer<typeof signInSchema>

/** Sign-up form payload: {@link signInSchema} plus the name Better Auth requires. */
export const signUpSchema = signInSchema.extend({
  name: z
    .string()
    .trim()
    .min(1, { error: '名前を入力してください' })
    .max(50, { error: '名前は50文字以内にしてください' }),
})
export type SignUpInput = z.infer<typeof signUpSchema>

/**
 * First Zod message per top-level field, the shape inline form errors want ({@link useAuthForm}).
 * @example firstIssuePerField(signInSchema.safeParse({ email: 'x', password: '' }).error) // { email: '…', password: '…' }
 */
export function firstIssuePerField(error: z.ZodError): Record<string, string> {
  const messages: Record<string, string> = {}
  for (const issue of error.issues)
    messages[String(issue.path[0])] ??= issue.message
  return messages
}

import { z } from 'zod'

import { ACTIVITY_PALETTE } from './activity-palette'
import { isCalendarDay, isTimeZone } from './time'

/** Accepts only the 8 design palette hexes; keeps the DB free of arbitrary colours. */
export const activityColorSchema = z.enum(ACTIVITY_PALETTE)

/** Switch-button label; short so it fits the 2x3 grid on mobile. */
export const activityNameSchema = z.string().trim().min(1).max(20)

/** Daily target in hours; `null` means "no target" (no ring/target line). */
export const targetHoursSchema = z.number().min(0).max(24).nullable()

/** Theme setting persisted per user (Settings > Appearance); the DB enum is built from the same tuple. */
export const THEME_MODES = ['auto', 'light', 'dark'] as const
export const themeModeSchema = z.enum(THEME_MODES)
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

/** Calendar day as the API exchanges it ('YYYY-MM-DD', a real date). */
export const daySchema = z
  .string()
  .refine(isCalendarDay, { error: '日付が正しくありません' })

/** 'YYYY-MM' for `stats.month`. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: '月が正しくありません' })

/** IANA zone; {@link isTimeZone} works on Hermes too. */
export const timeZoneSchema = z
  .string()
  .refine(isTimeZone, { error: 'タイムゾーンが正しくありません' })

/** Settings sheet payload: any subset of the user_settings columns the UI edits. */
export const settingsUpdateSchema = z
  .object({
    theme: themeModeSchema,
    showSecondHand: z.boolean(),
    // 無操作とみなす時間 in minutes, 15 min … 24 h.
    idleThresholdMinutes: z.int().min(15).max(1440),
    autoExcludeUnusedDays: z.boolean(),
    timeZone: timeZoneSchema,
  })
  .partial()
  .refine((update) => Object.keys(update).length > 0, {
    error: '変更がありません',
  })
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>

/** Active activity ids in their new order; the router checks it is a permutation of the user's active set. */
export const reorderInputSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(100),
})

/** One of a day's own rows as the correction sheet listed it: what a baseline or 「元に戻す」's expectation compares. */
const dayRowSchema = z.object({
  id: z.uuid(),
  activityId: z.uuid().nullable(),
  startedAt: z.coerce.date(),
})
export type DayRow = z.infer<typeof dayRowSchema>

// A day holds a few dozen switches; 500 bounds a request without ever refusing a real one.
const dayRowsSchema = z.array(dayRowSchema).max(500)

/**
 * The day a correction-sheet edit was made on, as the sheet saw it: the stored zone and the day's own rows, oldest first. The
 * router refuses the edit (CONFLICT, {@link DAY_CHANGED_REFUSAL}) unless the day still reads exactly so, which makes the
 * sheet's snapshot the day's true state before the edit and lets 「元に戻す」 know the state the edit left.
 */
const dayBaselineSchema = z.object({
  day: daySchema,
  timeZone: timeZoneSchema,
  rows: dayRowsSchema,
})
export type DayBaseline = z.infer<typeof dayBaselineSchema>

// Every correction-sheet edit of the day's own rows names its baseline; a pick on the carried-in record names its revision
// instead, and the API's own tests edit without either.
const withBaseline = { baseline: dayBaselineSchema.optional() }

/** 前の記録に統合 / 次の記録に統合 / 半分で分割: a row and, from the sheet, its day's baseline. */
export const rowEditInputSchema = z.object({ id: z.uuid(), ...withBaseline })

/** Correction sheet ±15 min step; the router clamps to the neighbouring switches. */
export const moveStartInputSchema = z.object({
  id: z.uuid(),
  deltaMinutes: z.literal([15, -15]),
  ...withBaseline,
})

/**
 * 活動を変える: `revision` makes the write conditional on the record being unchanged since (the carried-in pick and its undo);
 * `baseline` is the day's, for the picks the day undo covers.
 */
export const changeActivityInputSchema = z.object({
  id: z.uuid(),
  activityId: z.uuid().nullable(),
  revision: z.int().nonnegative().optional(),
  ...withBaseline,
})

/** 「ここで分割」 on the record carried into a day: cut it at `at`; the router keeps a minute from both ends and from now. */
export const splitAtInputSchema = z.object({
  id: z.uuid(),
  at: z.coerce.date(),
  ...withBaseline,
})
/** The client types its call with this alias: oRPC types the input from zod's input side, where `z.coerce.date()` is `unknown`. */
export type SplitAtInput = z.infer<typeof splitAtInputSchema>

/**
 * The `data` of the BAD_REQUEST that `switchTo` and `changeActivity` answer for an archived activity. The API throws it and
 * the correction sheet's undo reads it, so the two sides share one value rather than two string literals.
 * @example new ORPCError('BAD_REQUEST', { message: 'activity is archived', data: ARCHIVED_REFUSAL })
 */
export const ARCHIVED_REFUSAL = Object.freeze({ reason: 'archived' } as const)

/**
 * The `data` of the CONFLICT a correction answers when the day no longer reads as the sheet saw it (another device or tab
 * wrote since, or the stored zone moved the day's window): an edit's {@link dayBaselineSchema} or 「元に戻す」's `expected`.
 * @example new ORPCError('CONFLICT', { message: 'day changed elsewhere', data: DAY_CHANGED_REFUSAL })
 */
export const DAY_CHANGED_REFUSAL = Object.freeze({
  reason: 'day-changed',
} as const)

/**
 * Whole-day rewrite behind 「元に戻す」: the day's previous rows, oldest first (`activityId` null is a detox row), written only
 * while the stored zone is still `timeZone` and the day's rows are still exactly `expected`, the rows the edit left.
 */
export const replaceDayInputSchema = z.object({
  day: daySchema,
  timeZone: timeZoneSchema,
  expected: dayRowsSchema,
  rows: z
    .array(
      z.object({ activityId: z.uuid().nullable(), startedAt: z.coerce.date() }),
    )
    .max(500),
})
export type ReplaceDayInput = z.infer<typeof replaceDayInputSchema>

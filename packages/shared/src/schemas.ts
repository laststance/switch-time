import { z } from 'zod'

import { ACTIVITY_PALETTE } from './activity-palette'
import { EARLIEST_DAY, isCalendarDay, isTimeZone, LATEST_DAY } from './time'

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

/** Calendar day as the API exchanges it ('YYYY-MM-DD', a real date, four-digit year, from {@link EARLIEST_DAY} to {@link LATEST_DAY}). */
export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: '日付が正しくありません' })
  .refine(isCalendarDay, { error: '日付が正しくありません' })
  .refine((day) => day >= EARLIEST_DAY && day <= LATEST_DAY, {
    error: '日付が正しくありません',
  })

/** 'YYYY-MM' for `stats.month`, from the month of {@link EARLIEST_DAY} to that of {@link LATEST_DAY}. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: '月が正しくありません' })
  .refine(
    (month) =>
      month >= EARLIEST_DAY.slice(0, 7) && month <= LATEST_DAY.slice(0, 7),
    { error: '月が正しくありません' },
  )

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

/**
 * The most rows of one day a baseline lists, and 「元に戻す」 writes back. A day holds a few dozen switches; this bound keeps
 * the undo of a split on the busiest listed day (`rows` of this many, `expected` of one more) under the API's request body
 * limit. A busier day is still corrected, with a baseline that lists no rows and no 「元に戻す」.
 */
export const DAY_ROWS_MAX = 300

// The rows an edit is checked against; one over {@link DAY_ROWS_MAX}, since a split on the busiest listed day leaves one
// more, which its undo must name as `expected`.
const dayRowsSchema = z.array(dayRowSchema).max(DAY_ROWS_MAX + 1)

// The first switch after the day, where the day's last row ends (null: none yet), as `switches.listByDay`'s `carriedOut`
// names it. A write from the next day's sheet (a merge into this day's last row, a cut of it) changes it without touching
// the day's rows. Left out, it is not compared (the API's own tests).
const carriedOutIdSchema = z.uuid().nullable().optional()

// The record carried into the day (the latest switch before it; null: none) with the `revision` the sheet listed. A write on
// the earlier day's sheet changes it without touching the day's rows, and 前の記録に統合 on the day's first row hands time to
// it. Left out, it is not compared (the API's own tests, and clients from before it was sent).
const carriedInSchema = z
  .object({ id: z.uuid(), revision: z.int().nonnegative() })
  .nullable()
  .optional()

/**
 * The day a correction-sheet edit was made on, as the sheet saw it: the stored zone, the day's own rows, oldest first, the
 * record carried into it and the switch its last row runs into. The router refuses the edit (CONFLICT,
 * `REFUSAL.dayChanged`) unless the day still reads exactly so, which makes the sheet's snapshot the day's true state
 * before the edit and lets 「元に戻す」 know the state the edit left. `rows` is left out on a day busier than
 * {@link DAY_ROWS_MAX}: the router then checks the rest, and that the edited row is inside the day.
 */
const dayBaselineSchema = z.object({
  day: daySchema,
  timeZone: timeZoneSchema,
  rows: dayRowsSchema.optional(),
  carriedIn: carriedInSchema,
  carriedOutId: carriedOutIdSchema,
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
 * Why the API refused a timeline write, sent as the error's `data` (`{ reason }`) so the correction sheet can say it in
 * Japanese: the English `message` is for logs, and one error code (CONFLICT) covers most of these.
 */
const refusalReasonSchema = z.enum([
  'day-changed',
  'record-changed',
  'archived',
  'no-room',
  'no-neighbour',
  'next-on-later-day',
  'cannot-split',
  'busy',
])
export type RefusalReason = z.infer<typeof refusalReasonSchema>

/** The shape of a refusal's `data`; the app parses an error's `data` with it. */
export const refusalDataSchema = z.object({ reason: refusalReasonSchema })

/**
 * The `data` of every refusal a timeline write can answer, one per {@link RefusalReason}. The API throws them and the app
 * reads them, so the two sides share one value rather than two string literals. Each entry is frozen too, because every
 * error thrown with it carries the same object.
 * - `dayChanged`: CONFLICT, the day no longer reads as the sheet saw it (another device or tab wrote since, or the stored
 *   zone moved the day's window): an edit's {@link dayBaselineSchema} or 「元に戻す」's `expected`.
 * - `recordChanged`: CONFLICT, a pick names a revision another write has moved on from.
 * - `archived`: BAD_REQUEST, `switchTo` and `changeActivity` name an archived activity, or `replaceDay` and
 *   `mergeIntoPrevious` would make a record of one the current state.
 * - `noRoom`: CONFLICT, `moveStart` has no room left, or would leave the baseline's day.
 * - `noNeighbour`: CONFLICT, a merge has no previous or next record to merge into.
 * - `nextOnLaterDay`: CONFLICT, 「次の記録に統合」 would pull back a record from a later day.
 * - `cannotSplit`: CONFLICT, a split would leave a part under a minute, or fall outside its record or the baseline's day.
 * - `busy`: TOO_MANY_REQUESTS, the account already has its cap of timeline writes in flight, or the write reached the
 *   request's deadline while queued behind the account's earlier writes. Nothing was saved either way.
 * @example new ORPCError('CONFLICT', { message: 'day changed elsewhere', data: REFUSAL.dayChanged })
 */
export const REFUSAL = Object.freeze({
  dayChanged: Object.freeze({ reason: 'day-changed' }),
  recordChanged: Object.freeze({ reason: 'record-changed' }),
  archived: Object.freeze({ reason: 'archived' }),
  noRoom: Object.freeze({ reason: 'no-room' }),
  noNeighbour: Object.freeze({ reason: 'no-neighbour' }),
  nextOnLaterDay: Object.freeze({ reason: 'next-on-later-day' }),
  cannotSplit: Object.freeze({ reason: 'cannot-split' }),
  busy: Object.freeze({ reason: 'busy' }),
} as const satisfies Record<string, z.infer<typeof refusalDataSchema>>)

/**
 * Whole-day rewrite behind 「元に戻す」: the day's previous rows, oldest first (`activityId` null is a detox row), written only
 * while the stored zone is still `timeZone`, the day's rows are still exactly `expected`, the rows the edit left, and its last
 * row still runs into `carriedOutId` (an edit never changes it, so it is the baseline's). `account` is the user the edit was
 * written as (its returned row's `userId`): a tab that another tab has since signed in as someone else still sends the new session's cookie, and a detox-only
 * day passes every other check on an empty day. Left out, it is not compared (seeds and the API's own tests).
 */
export const replaceDayInputSchema = z.object({
  day: daySchema,
  timeZone: timeZoneSchema,
  expected: dayRowsSchema,
  carriedOutId: carriedOutIdSchema,
  account: z.string().optional(),
  rows: z
    .array(
      z.object({ activityId: z.uuid().nullable(), startedAt: z.coerce.date() }),
    )
    .max(DAY_ROWS_MAX),
})
export type ReplaceDayInput = z.infer<typeof replaceDayInputSchema>

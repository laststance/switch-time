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

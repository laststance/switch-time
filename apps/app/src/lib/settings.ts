import type { AppRouterClient } from '@switch-time/api'
import {
  ACTIVITY_PALETTE,
  addDays,
  type ActivityColor,
} from '@switch-time/shared'

/** One `settings.get` answer: the user's row. */
export type Settings = Awaited<ReturnType<AppRouterClient['settings']['get']>>
type ActivityRow = Awaited<
  ReturnType<AppRouterClient['activities']['list']>
>[number]

/** The row's own column defaults: what every screen shows until `settings.get` has answered (and while signed out). */
export const SETTINGS_DEFAULTS: Pick<
  Settings,
  | 'theme'
  | 'showSecondHand'
  | 'idleThresholdMinutes'
  | 'autoExcludeUnusedDays'
  | 'timeZone'
> = {
  theme: 'auto',
  showSecondHand: true,
  idleThresholdMinutes: 720,
  autoExcludeUnusedDays: true,
  timeZone: 'Asia/Tokyo',
}

const MINUTES_PER_HOUR = 60
/** 「無操作とみなす時間」 choices, the sheet's four buttons (the design's 6/8/10/12 h; the API takes any 15 min … 24 h). */
export const IDLE_OPTIONS = [6, 8, 10, 12].map((hours) => ({
  value: hours * MINUTES_PER_HOUR,
  label: `${hours}h`,
}))
// How far back 「除外中の日」 looks; a year of manual exclusions is more than the list can usefully show.
const EXCLUDED_LOOKBACK_DAYS = 365

/**
 * The idle threshold as the sheet writes it: whole hours as `12時間`, anything else in minutes (the API accepts any value from 15 min).
 * @example idleLabel(720) // '12時間'
 */
export function idleLabel(minutes: number): string {
  return minutes % MINUTES_PER_HOUR === 0
    ? `${minutes / MINUTES_PER_HOUR}時間`
    : `${minutes}分`
}

/**
 * The 未使用日の自動除外 row's sub line on 設定; a dash until the row has been read, since {@link SETTINGS_DEFAULTS} would otherwise be summarised as the account's own answer.
 * @example exclusionSummary({ autoExcludeUnusedDays: true, idleThresholdMinutes: 720 }, true) // 'オン · 無操作 12時間以上'
 */
export function exclusionSummary(
  settings: Pick<Settings, 'autoExcludeUnusedDays' | 'idleThresholdMinutes'>,
  ready: boolean,
): string {
  if (!ready) return '—'
  return settings.autoExcludeUnusedDays
    ? `オン · 無操作 ${idleLabel(settings.idleThresholdMinutes)}以上`
    : 'オフ'
}

/**
 * What the 1日の目安 field commits: blank is "no target" (null); the number otherwise (`activityInputSchema` then refuses anything outside 0–24, so the edit is dropped).
 * @example targetHoursFromText('1.5') // 1.5
 */
export function targetHoursFromText(text: string): number | null {
  return text.trim() === '' ? null : Number(text)
}

/**
 * The colour a new activity gets: the first palette entry no live activity uses, the first entry again once all eight are taken.
 * @example spareColor(['#E0A431', '#3B7BD9']) // '#4FA877'
 */
export function spareColor(usedColors: string[]): ActivityColor {
  return (
    ACTIVITY_PALETTE.find((color) => !usedColors.includes(color)) ??
    ACTIVITY_PALETTE[0]
  )
}

/**
 * The ids with `id` moved one step up (`-1`) or down (`1`); unchanged at either end or for an unknown id (`activities.reorder` takes the whole permutation).
 * @example reorderIds(['a', 'b', 'c'], 'c', -1) // ['a', 'c', 'b']
 */
export function reorderIds(ids: string[], id: string, delta: 1 | -1): string[] {
  const from = ids.indexOf(id)
  const to = from + delta
  if (from === -1 || to < 0 || to >= ids.length) return ids
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

/**
 * The 「除外中の日」 query window: the last year ending today.
 * @example excludedRange('2026-09-09') // { from: '2025-09-09', to: '2026-09-09' }
 */
export function excludedRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -EXCLUDED_LOOKBACK_DAYS), to: today }
}

export type EditorRow = ActivityRow & {
  /** `8`, `1.5`, or blank for no target: the 1日の目安 field's text. */
  targetText: string
  canMoveUp: boolean
  canMoveDown: boolean
  /** The current state's activity and the last live one cannot be archived (the API answers CONFLICT). */
  canArchive: boolean
}

/**
 * The 活動項目 sheet's rows from `activities.list`: live rows in `position` order with the flags for ▲ ▼ 🗑 decided here, so the sheet only renders. Undefined input (still loading) gives no rows.
 * @example editorRows(list, current?.activityId ?? null)
 */
export function editorRows(
  activities: ActivityRow[] | undefined,
  currentActivityId: string | null,
): EditorRow[] {
  const live = (activities ?? []).filter((row) => row.archivedAt === null)
  return live.map((row, index) => ({
    ...row,
    targetText: row.targetHours === null ? '' : String(row.targetHours),
    canMoveUp: index > 0,
    canMoveDown: index < live.length - 1,
    canArchive: row.id !== currentActivityId && live.length > 1,
  }))
}

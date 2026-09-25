import type { AppRouterClient } from '@switch-time/api'
import {
  ACTIVITY_PALETTE,
  addDays,
  type ActivityColor,
  type SettingsUpdate,
} from '@switch-time/shared'

import type { ActivityRow } from './orpc'

/** One `settings.get` answer: the user's row. */
export type Settings = Awaited<ReturnType<AppRouterClient['settings']['get']>>

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

/**
 * The routers {@link useUpdateSettings} refetches once the last in-flight update settles: `settings.*` for the row, `stats.*`
 * because the idle threshold and the unused-day rule change every total, and `switches.*` because a stored-zone change moves
 * every day's window. `switches` is there even for a theme tap, since the last update of a batch may follow a zone write.
 * @example SETTINGS_REFETCH_ROUTERS.map((router) => orpc[router].key())
 */
export const SETTINGS_REFETCH_ROUTERS = [
  'settings',
  'stats',
  'switches',
] as const

/** What {@link useTimeZoneSync} does with the device's zone: write it to the account, only remember it, or nothing. */
export type ZoneSyncAction = 'write' | 'record' | 'none'

/**
 * The zone write a settings mutation last sent, when it failed: its variables, undefined otherwise. The failure holds only for
 * that account and that zone, so a rollback does not start the same write again, while the next account, or a device that
 * moved on, writes as usual. Read by {@link zoneSyncAction} and {@link zoneRow}.
 */
export type FailedZoneWrite =
  Pick<SettingsUpdate, 'forUserId' | 'timeZone'> | undefined

// The failed write was this account's and this zone's: sending it again would only repeat the failure.
const failedHere = (
  failedWrite: FailedZoneWrite,
  account: string | undefined,
  device: string,
): boolean =>
  failedWrite !== undefined &&
  failedWrite.forUserId === account &&
  failedWrite.timeZone === device

/**
 * Whether this device writes its zone into the account's `settings.timeZone`. It writes only when its own zone differs from
 * the one it last synced for the account (a fresh install, or the device moved), so two devices in different zones no longer
 * overwrite each other on every focus. When the account already holds the device's zone, the device only remembers it,
 * and only once no settings write is in flight: the cached value may be an optimistic one that a failed write rolls back.
 * @param zones.stored - The account's zone as `settings.get` last answered (or the optimistic value of a write in flight).
 * @param zones.device - The device's IANA zone.
 * @param zones.lastSynced - The zone this device last synced for the account, null when it never did.
 * @param zones.settled - The settings row has loaded for a signed-in account and no settings write is in flight.
 * @param zones.failedWrite - The sync's last write, when it failed ({@link FailedZoneWrite}).
 * @param zones.account - The session's user id, undefined while signed out.
 * @param zones.rowAccount - The `userId` of the settings row `stored` came from, undefined until it has loaded. In the commit
 *   where the session turns to another account the cache still holds the previous account's row, and its zone must not be
 *   remembered (or written over) as the new account's.
 * @returns
 * - 'write': the device's zone differs from both the account's and the one it last synced
 * - 'record': the account already holds the device's zone, which the device has not remembered yet
 * - 'none': otherwise, while not settled, while the row is not the session account's own, or when this very write failed
 * @example zoneSyncAction({ stored: 'UTC', device: 'Asia/Tokyo', lastSynced: 'Asia/Tokyo', settled: true, failedWrite: undefined, account: 'u1', rowAccount: 'u1' }) // 'none': another device set UTC
 */
export function zoneSyncAction(zones: {
  stored: string
  device: string
  lastSynced: string | null
  settled: boolean
  failedWrite: FailedZoneWrite
  account: string | undefined
  rowAccount: string | undefined
}): ZoneSyncAction {
  const { stored, device, lastSynced, settled, failedWrite, account } = zones
  // Positive ownership: an unloaded row (undefined) or another account's row never counts.
  const ownRow = account !== undefined && account === zones.rowAccount
  if (!settled || !ownRow || lastSynced === device) return 'none'
  if (failedHere(failedWrite, account, device)) return 'none'
  return stored === device ? 'record' : 'write'
}

/** What 設定's タイムゾーン row shows: its sub line, whether that line is the failure alert, and whether the take-back button shows. */
export type ZoneRow = { summary: string; alert: boolean; canTakeBack: boolean }

/**
 * The タイムゾーン row on 設定, rendered by {@link TimeZoneRow} through {@link useAccountZone}. A matching zone wins over a failed
 * take-back, since a later read that already matches makes the failure line stale.
 * @param zones.stored - The account's zone (the optimistic one while a take-back is in flight, so the row reads "same" at once).
 * @param zones.device - This device's IANA zone.
 * @param zones.ready - The settings row has been read.
 * @param zones.failedWrite - The last take-back, when it failed and nothing has been tapped since ({@link FailedZoneWrite}).
 * @param zones.account - The session's user id, undefined while signed out.
 * @param zones.rowAccount - The `userId` of the cached settings row: after a switch to another account it can still be the
 *   previous account's, whose zone must not read as the new account's.
 * @returns
 * - not ready, or not the session account's row: a dash, no button
 * - same zone: `Asia/Tokyo · この端末と同じ`, no button
 * - failed for this account and this zone: the alert line, button kept for another try
 * - otherwise: `America/New_York · この端末は Asia/Tokyo`, button
 * @example zoneRow({ stored: 'UTC', device: 'Asia/Tokyo', ready: true, failedWrite: undefined, account: 'u1', rowAccount: 'u1' }) // { summary: 'UTC · この端末は Asia/Tokyo', alert: false, canTakeBack: true }
 */
export function zoneRow(zones: {
  stored: string
  device: string
  ready: boolean
  failedWrite: FailedZoneWrite
  account: string | undefined
  rowAccount: string | undefined
}): ZoneRow {
  const { stored, device, ready, failedWrite, account } = zones
  const ownRow = account !== undefined && account === zones.rowAccount
  if (!ready || !ownRow)
    return { summary: '—', alert: false, canTakeBack: false }
  if (stored === device)
    return {
      summary: `${stored} · この端末と同じ`,
      alert: false,
      canTakeBack: false,
    }
  if (failedHere(failedWrite, account, device))
    return {
      summary: '保存できませんでした。もう一度お試しください',
      alert: true,
      canTakeBack: true,
    }
  return {
    summary: `${stored} · この端末は ${device}`,
    alert: false,
    canTakeBack: true,
  }
}

/**
 * What a failed settings write puts back into the `settings.get` cache: its snapshot, unless the cache now holds another
 * account's row (a sign-in landed while the write was out), which the previous account's row must not replace. Called from
 * {@link useUpdateSettings}' rollback.
 * @param current - The cached row now, undefined once the cache was cleared.
 * @param previous - The row the write's optimistic update replaced.
 * @returns
 * - the same account's row (or both undefined): `previous`
 * - another account's row, or a cleared cache: `current`, left as it is
 * @example rolledBackSettings({ userId: 'b', timeZone: 'UTC' }, { userId: 'a', timeZone: 'Asia/Tokyo' }) // { userId: 'b', timeZone: 'UTC' }
 */
export function rolledBackSettings<Row extends { userId: string }>(
  current: Row | undefined,
  previous: Row | undefined,
): Row | undefined {
  return current?.userId === previous?.userId ? previous : current
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

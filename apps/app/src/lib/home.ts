import {
  DETOX_MEASURED_DAYS_MAX,
  detoxRunLastDay,
  detoxRunPastWeek,
  type DayStats,
} from '@switch-time/shared'

import { DETOX } from './detox'

/** What Home renders when it has no state to show: the retry notice, the first-launch screen, or the bare frame. */
export type HomeFallback = 'error' | 'first-launch' | 'loading'

/**
 * Picks Home's fallback screen. First launch is exactly "the fetch succeeded and there is no current state", so a failed or
 * in-flight fetch never flashes it; a failed one offers a retry instead of a frame that never resolves.
 * @example homeFallback({ isPending: false, isError: false, hasCurrent: false }) // 'first-launch'
 */
export function homeFallback({
  isPending,
  isError,
  hasCurrent,
}: {
  isPending: boolean
  isError: boolean
  hasCurrent: boolean
}): HomeFallback {
  if (isError) return 'error'
  if (isPending || hasCurrent) return 'loading'
  return 'first-launch'
}

/**
 * Whether Home can show its body: the current switch's activity row is here, or the switch is detox (no activity by design) and
 * the activity list has answered at least once, so the switch buttons never flash empty. A refetch that fails keeps the cached
 * list, so detox stays on screen through it; only a list that never loaded falls to {@link homeFallback}.
 * @example homeReady({ current: { activityId: null }, activity: null, activitiesLoaded: true }) // true while detox
 */
export function homeReady({
  current,
  activity,
  activitiesLoaded,
}: {
  current: { activityId: string | null }
  activity: { id: string } | null
  activitiesLoaded: boolean
}): boolean {
  return activity !== null || (current.activityId === null && activitiesLoaded)
}

/** The two lines under the hero's subtext on the last day a detox run measures, or a day it no longer does (pen `ST Phone / ホーム・detox の状態`). */
export type HeroNotice = { title: string; body: string }

/**
 * Which detox notice the hero shows: `last-day` on the run's last measured day ({@link detoxLastDay}), `stopped` on a day it
 * no longer measures ({@link detoxStopped}), null otherwise.
 */
export type DetoxNotice = 'last-day' | 'stopped' | null

/**
 * What the hero shows for the current state; `color` null is detox, which has no colour of its own. `notice` is null except on a
 * detox run's last measured day and on a day past its week ({@link DetoxNotice}).
 */
export type NowLook = {
  name: string
  color: string | null
  subtext: string
  notice: HeroNotice | null
}

// Both state the rule rather than count from the since label: a cut can start the record after its run did, so no ordinal day.
const DETOX_NOTICES: Record<NonNullable<DetoxNotice>, HeroNotice> = {
  'last-day': {
    title: '明日から計測に入りません',
    body: `デトックスの計測は始めた翌日から${DETOX_MEASURED_DAYS_MAX}日間まで。明日はデトックスを押し直すと、また${DETOX_MEASURED_DAYS_MAX}日間計測に入ります。`,
  },
  stopped: {
    title: '今日は計測に入りません',
    body: `デトックスの計測は始めた翌日から${DETOX_MEASURED_DAYS_MAX}日間まで。デトックスを押し直すか行動へ切り替えると、今日も計測に入ります。`,
  },
}

/**
 * The hero's texts and colour for the current state: the activity in its own colour with today's switch count, or detox in no
 * colour with the reminder that nothing accumulates, plus the notice on the detox run's last measured day or past its week.
 * @param activity - The current activity, or null for detox.
 * @param since - When the current record started ({@link formatSince}).
 * @param switchCount - Today's switches.
 * @param notice - The detox notice for today ({@link DetoxNotice}); ignored for an activity.
 * @returns The name, colour, subtext and notice NowPanel draws.
 * @example nowLook(null, '21:20', 3, null).subtext // '21:20 から · どの行動にも積み上がりません'
 * @example nowLook(null, '9月16日 21:20', 0, 'stopped').notice?.title // '今日は計測に入りません'
 */
export function nowLook(
  activity: { name: string; color: string } | null,
  since: string,
  switchCount: number,
  notice: DetoxNotice,
): NowLook {
  if (activity === null)
    return {
      name: DETOX.name,
      color: DETOX.color,
      subtext: `${since} から · どの行動にも積み上がりません`,
      notice: notice === null ? null : DETOX_NOTICES[notice],
    }
  return {
    name: activity.name,
    color: activity.color,
    subtext: `${since} から · 今日 ${switchCount} 回切替`,
    notice: null,
  }
}

/**
 * The current switch as Home's detox rules read it: `runStartDay` is the day its detox run started in the stored zone, as
 * `switches.current` answers it (null while an activity runs, and on the optimistic row a tap writes until the refetch lands).
 */
type RunningSwitch = { activityId: string | null; runStartDay: string | null }

/** Today as Home knows it: the current switch, the stored zone's day and today's own switch count. */
type HomeToday = {
  current: RunningSwitch
  today: string
  /** Today's switches from the day's own list, which lands before a stats refetch does. */
  switchCountToday: number
  /** The stored unused-day rule: while it is off the server measures every day, so no detox stops counting. */
  autoExcludeUnusedDays: boolean
}

/**
 * Whether a detox runs whose run started more than {@link DETOX_MEASURED_DAYS_MAX} days before today, with no switch today: the
 * only state that can be past the detox week. Home asks `stats.day` for today only then, and {@link detoxStopped} reads the answer
 * only then. The server answers a day still in its future (a device clock ahead at midnight) as neither measured nor excluded, the
 * same as a stopped day; the week and the unused-day rule let that answer through only for a day past the week with auto-exclusion
 * on, which the server classes the same once it gets there. The run's start comes from the server, so a cut that started the
 * record after its run did still counts from the run's first day.
 * @returns
 * - true for a detox run started on `today - 8` or earlier with no tap today
 * - false for an activity, a detox inside its week (started today included), any day with a switch, the optimistic row (no
 *   run start yet), and while auto-exclusion is off (the server then measures every day)
 * @example detoxPastWeek({ current: { activityId: null, runStartDay: '2026-09-16' }, today: '2026-09-25', switchCountToday: 0, autoExcludeUnusedDays: true }) // true
 */
export function detoxPastWeek(input: HomeToday): boolean {
  return input.switchCountToday === 0 && detoxRenewable(input)
}

/**
 * Whether today is the last day the running detox measures, so Home can warn that tomorrow will not count. It needs no server
 * answer: the run's start and the unused-day rule decide it, and a day with a tap counts anyway.
 * @returns
 * - true for a detox whose run started exactly {@link DETOX_MEASURED_DAYS_MAX} days before today, with auto-exclusion on
 * - false for an activity, any other day of the run, the optimistic row (no run start yet), and while auto-exclusion is off
 * @example detoxLastDay({ current: { activityId: null, runStartDay: '2026-09-16' }, today: '2026-09-23', autoExcludeUnusedDays: true }) // true
 */
export function detoxLastDay(
  input: Pick<HomeToday, 'current' | 'today' | 'autoExcludeUnusedDays'>,
): boolean {
  const { current } = input
  if (!input.autoExcludeUnusedDays || current.activityId !== null) return false
  if (current.runStartDay === null) return false
  return detoxRunLastDay(current.runStartDay) === input.today
}

/**
 * Whether pressing detox again starts a new run: detox runs, its run's measured week ended before today, and auto-exclusion
 * is on (while it is off every day is measured, so a new run would change nothing). It is the only rule that lets a press on
 * the active state through (the detox row and the `0` hotkey), and it switches the detox row's hint. The server applies the
 * same week rule and the unused-day rule under its lock ({@link detoxRunPastWeek} in switchTo) and keeps the running record
 * otherwise, so a press sent from a stale `today` or a stale rule changes nothing. The optimistic row a press writes has no run start, so a second press before the
 * refetch is dropped.
 * @returns
 * - true for a detox run started on `today - 8` or earlier, with auto-exclusion on
 * - false for an activity, a detox inside its week, the optimistic row, and while auto-exclusion is off
 * @example detoxRenewable({ current: { activityId: null, runStartDay: '2026-09-16' }, today: '2026-09-24', autoExcludeUnusedDays: true }) // true
 */
export function detoxRenewable(
  input: Pick<HomeToday, 'current' | 'today' | 'autoExcludeUnusedDays'>,
): boolean {
  const { current } = input
  if (!input.autoExcludeUnusedDays || current.activityId !== null) return false
  return detoxRunPastWeek(current.runStartDay, input.today)
}

/**
 * Whether today is a day the running detox no longer measures, as the server classes it, so Home can say so. The answer is trusted
 * only while it can still describe today.
 * @param input.stats - The `stats.day` query for today: its last answer, whether its last fetch failed or waits for the network.
 * @returns
 * - true when {@link detoxPastWeek} holds and the last trusted answer reads today as neither measured nor excluded (auto-exclusion
 *   off always measures)
 * - false for an activity, a detox started today, a day with a switch, a manual exclusion, a measured day, and while no answer
 *   can be trusted (none yet, a failed or paused fetch, an answer for another day): unknown is not "stopped"
 * @example detoxStopped({ current: { activityId: null, runStartDay: '2026-09-16' }, today: '2026-09-25', switchCountToday: 0, autoExcludeUnusedDays: true, stats: { isError: false, isPaused: false, data: { days: [{ day: '2026-09-25', measured: false, excluded: null }] } } }) // true
 */
export function detoxStopped(
  input: HomeToday & {
    stats: {
      isError: boolean
      isPaused: boolean
      data:
        | { days: readonly Pick<DayStats, 'day' | 'measured' | 'excluded'>[] }
        | undefined
    }
  },
): boolean {
  const { stats } = input
  if (!detoxPastWeek(input)) return false
  // A failed or paused fetch keeps an answer that may predate a tap from another device.
  if (stats.isError || stats.isPaused) return false
  const answer = stats.data?.days[0]
  return (
    answer?.day === input.today && !answer.measured && answer.excluded === null
  )
}

/**
 * Which detox notice the hero shows today: the server-confirmed `stopped` first ({@link detoxStopped}), else `last-day`
 * ({@link detoxLastDay}), else none. Home calls it on every render with the `stats.day` query for today.
 * @returns
 * - 'stopped' when {@link detoxStopped} holds
 * - 'last-day' on the run's last measured day
 * - null otherwise (an activity, a detox inside its week, an unknown answer past it)
 * @example detoxNotice({ current: { activityId: null, runStartDay: '2026-09-16' }, today: '2026-09-23', switchCountToday: 0, autoExcludeUnusedDays: true, stats: { isError: false, isPaused: false, data: undefined } }) // 'last-day'
 */
export function detoxNotice(
  input: Parameters<typeof detoxStopped>[0],
): DetoxNotice {
  if (detoxStopped(input)) return 'stopped'
  if (detoxLastDay(input)) return 'last-day'
  return null
}

/**
 * Whether a press on a switch reaches the API. Pressing the active state again changes nothing (the server keeps that state,
 * or refuses it when its activity is archived), so Home skips the call and the refetches after it ({@link useSwitchTo}); the one exception
 * is detox past its run's week, where the press starts a new run. Home's buttons, detox row and hotkeys all go through it, and so
 * do the first-launch screen's hotkeys once a first press has placed its row ({@link FirstLaunch}).
 * @param input.activityId - The pressed state; null is detox.
 * @param input.renewable - {@link detoxRenewable} for the current state.
 * @returns
 * - true for a state other than the current one, and for detox pressed again while `renewable`
 * - false for any other press on the current state
 * @example sendsPick({ activityId: null, current: { activityId: null }, renewable: true }) // true
 */
export function sendsPick(input: {
  activityId: string | null
  current: { activityId: string | null }
  renewable: boolean
}): boolean {
  if (input.activityId !== input.current.activityId) return true
  return input.activityId === null && input.renewable
}

/**
 * The switch buttons: the live activities, plus the current one when another device archived it, kept last so the digit hotkeys
 * keep their places and the buttons never lose the state the hero is showing. Detox adds nothing: the detox row is its button.
 * @example gridActivities(live, activity)
 */
export function gridActivities<T extends { id: string }>(
  live: T[],
  activity: T | null,
): T[] {
  if (activity === null || live.some((row) => row.id === activity.id))
    return live
  return [...live, activity]
}

/**
 * The rail badge's ring class: `sub` while detox (the state with no colour, as on the dial), `line` before the first switch; an
 * activity's own colour goes on inline by the caller and wins over either.
 * @example badgeRing({ activityId: null }) // 'border-sub'
 */
export function badgeRing(
  current: { activityId: string | null } | null,
): 'border-sub' | 'border-line' {
  return current?.activityId === null ? 'border-sub' : 'border-line'
}

import {
  addDays,
  DETOX_MEASURED_DAYS_MAX,
  type DayStats,
  localDay,
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

/** The two lines under the hero's subtext on a day a running detox no longer measures (pen `ST Phone / ホーム・detox の状態`). */
export type HeroNotice = { title: string; body: string }

/**
 * What the hero shows for the current state; `color` null is detox, which has no colour of its own. `notice` is null except on a
 * day past a detox run's week ({@link detoxStopped}).
 */
export type NowLook = {
  name: string
  color: string | null
  subtext: string
  notice: HeroNotice | null
}

// States the rule rather than counting from the since label: a cut can start the record after its run did, so no ordinal day.
const DETOX_STOPPED_NOTICE: HeroNotice = {
  title: '今日は計測に入りません',
  body: `デトックスの計測は始めた翌日から${DETOX_MEASURED_DAYS_MAX}日間まで。今日中に行動へ切り替えると、今日も計測に入ります。`,
}

/**
 * The hero's texts and colour for the current state: the activity in its own colour with today's switch count, or detox in no
 * colour with the reminder that nothing accumulates, plus the notice once today is past the detox run's week.
 * @param activity - The current activity, or null for detox.
 * @param since - When the current record started ({@link formatSince}).
 * @param switchCount - Today's switches.
 * @param stopped - Whether a detox runs on a day it no longer measures ({@link detoxStopped}); ignored for an activity.
 * @returns The name, colour, subtext and notice NowPanel draws.
 * @example nowLook(null, '21:20', 3, false).subtext // '21:20 から · どの行動にも積み上がりません'
 * @example nowLook(null, '9月16日 21:20', 0, true).notice?.title // '今日は計測に入りません'
 */
export function nowLook(
  activity: { name: string; color: string } | null,
  since: string,
  switchCount: number,
  stopped: boolean,
): NowLook {
  if (activity === null)
    return {
      name: DETOX.name,
      color: DETOX.color,
      subtext: `${since} から · どの行動にも積み上がりません`,
      notice: stopped ? DETOX_STOPPED_NOTICE : null,
    }
  return {
    name: activity.name,
    color: activity.color,
    subtext: `${since} から · 今日 ${switchCount} 回切替`,
    notice: null,
  }
}

/** Today as Home knows it: the current switch, the stored zone's day and today's own switch count. */
type HomeToday = {
  current: { activityId: string | null; startedAt: Date }
  today: string
  timeZone: string
  /** Today's switches from the day's own list, which lands before a stats refetch does. */
  switchCountToday: number
  /** The stored unused-day rule: while it is off the server measures every day, so no detox stops counting. */
  autoExcludeUnusedDays: boolean
}

/**
 * Whether a detox runs whose record started more than {@link DETOX_MEASURED_DAYS_MAX} days before today, with no switch today: the
 * only state that can be past the detox week. Home asks `stats.day` for today only then, and {@link detoxStopped} reads the answer
 * only then. The server answers a day still in its future (a device clock ahead at midnight) as neither measured nor excluded, the
 * same as a stopped day; the week and the unused-day rule let that answer through only for a day past the week with auto-exclusion
 * on, which the server classes the same once it gets there. Counting from the record's start is conservative: a cut can start the
 * record after its run did, and such a run stays quiet (TODOS.md, the last-day warning, needs the run's start from the server).
 * @returns
 * - true for a detox record started on `today - 8` or earlier with no tap today
 * - false for an activity, a detox inside its week (started today included), any day with a switch, and while auto-exclusion is
 *   off (the server then measures every day)
 * @example detoxPastWeek({ current: { activityId: null, startedAt: new Date('2026-09-16T12:20:00Z') }, today: '2026-09-25', timeZone: 'Asia/Tokyo', switchCountToday: 0, autoExcludeUnusedDays: true }) // true
 */
export function detoxPastWeek(input: HomeToday): boolean {
  const { current } = input
  if (!input.autoExcludeUnusedDays) return false
  if (current.activityId !== null || input.switchCountToday > 0) return false
  const startDay = localDay(current.startedAt, input.timeZone)
  return addDays(startDay, DETOX_MEASURED_DAYS_MAX) < input.today
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
 * @example detoxStopped({ current: { activityId: null, startedAt }, today: '2026-09-25', timeZone: 'Asia/Tokyo', switchCountToday: 0, autoExcludeUnusedDays: true, stats: { isError: false, isPaused: false, data: { days: [{ day: '2026-09-25', measured: false, excluded: null }] } } }) // true
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

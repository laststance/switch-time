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
 * the activity list has answered, so the switch buttons never flash empty. Everything else falls to {@link homeFallback}.
 * @example homeReady({ current, activity: null, isPending: false, isError: false }) // true while detox
 */
export function homeReady({
  current,
  activity,
  isPending,
  isError,
}: {
  current: { activityId: string | null } | null
  activity: { id: string } | null
  isPending: boolean
  isError: boolean
}): boolean {
  if (!current) return false
  return (
    activity !== null || (current.activityId === null && !isPending && !isError)
  )
}

/** What the hero shows for the current state; `color` null is detox, which has no colour of its own. */
export type NowLook = { name: string; color: string | null; subtext: string }

/**
 * The hero's texts and colour for the current state: the activity in its own colour with today's switch count, or detox in no
 * colour with the reminder that nothing accumulates.
 * @example nowLook(null, '21:20', 3).subtext // '21:20 から · どの行動にも積み上がりません'
 */
export function nowLook(
  activity: { name: string; color: string } | null,
  since: string,
  switchCount: number,
): NowLook {
  if (activity === null)
    return {
      name: 'detox',
      color: null,
      subtext: `${since} から · どの行動にも積み上がりません`,
    }
  return {
    name: activity.name,
    color: activity.color,
    subtext: `${since} から · 今日 ${switchCount} 回切替`,
  }
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

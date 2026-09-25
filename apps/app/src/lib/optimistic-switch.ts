import type { QueryClient, QueryKey } from '@tanstack/react-query'

import type { CurrentSwitch } from '@/lib/orpc'

/** What `switches.current` can hold: the running record, `null` before the first switch, `undefined` before it ever loaded. */
type CurrentShown = CurrentSwitch | null | undefined

/** The mutation scope every tap runs in, one after another ({@link useSwitchTo}). */
export const SWITCH_TO_SCOPE = 'switches.switchTo'

/** The id of the row a tap shows before the server answers; never sent back to the server. */
export const OPTIMISTIC_ID = 'optimistic'

/** The last state the server confirmed, as one session of taps sees it. */
type ConfirmedState = { value: CurrentShown }

/**
 * What a tap's `onMutate` hands to its `onSuccess`, `onError` and `onSettled`: the cached row it placed, to tell whether the display
 * is still its own, and the confirmed state of the session it was made in, which {@link isLastTap} compares with the current one.
 */
export type TapContext = { placed: CurrentShown; confirmed: ConfirmedState }

// The last state the server confirmed, per client: an object held in a WeakMap, not a module `let` (the React Compiler folds such
// an alias into a comparison with itself).
const confirmedStates = new WeakMap<QueryClient, ConfirmedState>()

function confirmedStateOf(client: QueryClient): ConfirmedState {
  const known = confirmedStates.get(client)
  if (known) return known
  const created = { value: undefined }
  confirmedStates.set(client, created)
  return created
}

// Taps that have run `onMutate` and not yet settled, this one included: TanStack marks a mutation pending (paused while an earlier
// one in its scope runs) before it calls `onMutate`.
const tapsInFlight = (client: QueryClient): number =>
  client.isMutating({
    predicate: (mutation) => mutation.options.scope?.id === SWITCH_TO_SCOPE,
  })

/**
 * A tap's `onMutate`: shows the picked state at once and notes the state to fall back to. Unless the cache holds a tap's placeholder
 * (a later tap of the burst, or an accepted tap whose refetch has not landed, whose {@link confirmTap} already recorded its row), it
 * holds the server's latest read, so that becomes the confirmed state: at the first tap of a burst or of a new session, and after
 * the last tap's refetch of the current switch lands while it still waits for the day list.
 * @param client - The app's query client.
 * @param queryKey - `switches.current`'s key.
 * @param activityId - The picked activity, or `null` for detox.
 * @returns The context {@link confirmTap}, {@link rollBackTap} and {@link isLastTap} read.
 * @example onMutate: async ({ activityId }) => { await queryClient.cancelQueries({ queryKey }); return placeTap(queryClient, queryKey, activityId) }
 */
export function placeTap(
  client: QueryClient,
  queryKey: QueryKey,
  activityId: string | null,
): TapContext {
  const previous = client.getQueryData<CurrentShown>(queryKey)
  const confirmed = confirmedStateOf(client)
  // A server row, not a placeholder: a later confirmTap of a tap still queued overwrites it, so a newer answer still wins.
  if (previous?.id !== OPTIMISTIC_ID) confirmed.value = previous
  // Callers send only a change of state or a detox re-tap that starts a new run ({@link detoxRenewable}), so every call restarts
  // the counter right now. (A tab that missed another device turning the unused-day rule off still sends the re-tap; the server
  // keeps the running record, and the refetch after the last tap puts its start back and, unless a settings write is in flight,
  // brings the rule.) `id` after the spread: the placeholder row must never carry the previous row's id into a correction.
  // No run start until the refetch: the detox notices stay away and a second re-tap is dropped meanwhile.
  const next: CurrentSwitch = {
    userId: '',
    source: 'tap',
    createdAt: new Date(),
    ...previous,
    id: OPTIMISTIC_ID,
    revision: 0,
    activityId,
    startedAt: new Date(),
    startsRun: false,
    runStartDay: null,
  }
  client.setQueryData(queryKey, next)
  // Structural sharing stores a copy, so the cached object, not `next`, is what a later read compares against.
  return { placed: client.getQueryData<CurrentShown>(queryKey), confirmed }
}

/**
 * A tap's `onSuccess`: the server's row becomes the state a later refused tap of the same session falls back to.
 * @param context - What {@link placeTap} returned for this tap.
 * @param row - What `switches.switchTo` answered; its run start comes with the refetch.
 * @example onSuccess: (row, _input, context) => { if (context) confirmTap(context, row) }
 */
export function confirmTap(
  context: TapContext,
  row: Omit<CurrentSwitch, 'runStartDay'>,
): void {
  context.confirmed.value = { ...row, runStartDay: null }
}

/**
 * A tap's `onError`: while the display is still this tap's row, puts back the last state the server confirmed. Once a later tap
 * (or a refetch) has replaced it, the display is not this tap's to change, and another tap's row is never brought back.
 * @param client - The app's query client.
 * @param queryKey - `switches.current`'s key.
 * @param context - What {@link placeTap} returned for this tap.
 * @example onError: (_error, _input, context) => { if (context) rollBackTap(queryClient, queryKey, context) }
 */
export function rollBackTap(
  client: QueryClient,
  queryKey: QueryKey,
  context: TapContext,
): void {
  if (client.getQueryData(queryKey) === context.placed)
    client.setQueryData(queryKey, context.confirmed.value)
}

/**
 * Starts a new session of taps when the cache is cleared or reset for another account (sign-in, sign-out, {@link useAccountScope}).
 * A tap of the old session that is answered late then confirms into its own session's state, never into the one the new account's
 * refused taps fall back to, and leaves the refetch to the new session ({@link isLastTap}). The old account's taps still queued
 * behind a running one are dropped: they have not been sent, and would go out with the new account's session cookie.
 * @param client - The app's query client, right after `clear()` (which has already dropped every tap) or `resetQueries()`.
 * @example queryClient.clear(); startTapSession(queryClient)
 */
export function startTapSession(client: QueryClient): void {
  confirmedStates.delete(client)
  const mutations = client.getMutationCache()
  // A queued tap is paused until the running one settles; removed from its scope, it is never continued.
  for (const queued of mutations.findAll({
    predicate: (mutation) =>
      mutation.options.scope?.id === SWITCH_TO_SCOPE && mutation.state.isPaused,
  }))
    mutations.remove(queued)
}

/**
 * Whether a settling tap is the last of its burst, for {@link useSwitchTo}'s refetch: an earlier tap's refetch would replace the
 * queued taps' rows (their `onMutate` has already run), so only the last tap refetches. A tap of a session that has since ended
 * ({@link startTapSession}) refetches only while the new session has placed no tap: its refetch would land over the new account's
 * pick, yet with no pick it is what shows a detox tap that went out with the new account's cookie (the reset's own read can come
 * back before that tap is stored). After `clear()` the count misses the old tap, after `resetQueries()` it counts it.
 * @param client - The app's query client.
 * @param context - What {@link placeTap} returned for this tap; undefined when `onMutate` threw and nothing was placed.
 * @returns
 * - `true` when no other tap is waiting or running, and this tap belongs to the current session or the current one has no tap yet
 * - `false` otherwise
 * @example if (!isLastTap(queryClient, context)) return
 */
export function isLastTap(
  client: QueryClient,
  context: TapContext | undefined,
): boolean {
  if (context === undefined) return false
  const current = confirmedStates.get(client)
  // No confirmed state yet: the new session has placed no tap for this refetch to land over.
  const isOwnOrUntapped = current === undefined || context.confirmed === current
  return isOwnOrUntapped && tapsInFlight(client) <= 1
}

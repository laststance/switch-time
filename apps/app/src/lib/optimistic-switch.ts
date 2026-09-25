import type { QueryClient, QueryKey } from '@tanstack/react-query'

import type { CurrentSwitch } from '@/lib/orpc'

/** What `switches.current` can hold: the running record, `null` before the first switch, `undefined` before it ever loaded. */
type CurrentShown = CurrentSwitch | null | undefined

/** The mutation scope every tap runs in, one after another ({@link useSwitchTo}). */
export const SWITCH_TO_SCOPE = 'switches.switchTo'

/** The id of the row a tap shows before the server answers; never sent back to the server. */
export const OPTIMISTIC_ID = 'optimistic'

/** The last state the server confirmed, as one session of taps sees it; `isRecorded` stays false until its first tap notes one. */
type ConfirmedState = { value: CurrentShown; isRecorded: boolean }

/**
 * What a tap's `onMutate` hands to its `onSuccess` and `onError`: the cached row it placed, to tell whether the display is still
 * its own, and the confirmed state of the session it was made in.
 */
export type TapContext = { placed: CurrentShown; confirmed: ConfirmedState }

// The last state the server confirmed, per client: an object held in a WeakMap, not a module `let` (the React Compiler folds such
// an alias into a comparison with itself).
const confirmedStates = new WeakMap<QueryClient, ConfirmedState>()

function confirmedStateOf(client: QueryClient): ConfirmedState {
  const known = confirmedStates.get(client)
  if (known) return known
  const created = { value: undefined, isRecorded: false }
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
 * A tap's `onMutate`: shows the picked state at once and notes the state to fall back to. At the first tap of a burst the cache is
 * the server's state, so it becomes the confirmed one, unless it is the placeholder of a tap the server accepted whose refetch has
 * not landed yet (that tap's {@link confirmTap} already recorded its row). So does the first tap of a new session, even while a
 * tap of the previous account still waits in the scope.
 * @param client - The app's query client.
 * @param queryKey - `switches.current`'s key.
 * @param activityId - The picked activity, or `null` for detox.
 * @returns The context {@link rollBackTap} needs.
 * @example onMutate: async ({ activityId }) => { await queryClient.cancelQueries({ queryKey }); return placeTap(queryClient, queryKey, activityId) }
 */
export function placeTap(
  client: QueryClient,
  queryKey: QueryKey,
  activityId: string | null,
): TapContext {
  const previous = client.getQueryData<CurrentShown>(queryKey)
  const confirmed = confirmedStateOf(client)
  // A tap of the previous account can still be counted after `resetQueries` (another tab's sign-in), so a new session records
  // its first tap's state without waiting for a burst to start.
  if (
    previous?.id !== OPTIMISTIC_ID &&
    (!confirmed.isRecorded || tapsInFlight(client) === 1)
  ) {
    confirmed.value = previous
    confirmed.isRecorded = true
  }
  // Callers send only a change of state or a detox re-tap that starts a new run ({@link detoxRenewable}), so every call restarts
  // the counter right now. (A tab that missed another device turning the unused-day rule off still sends the re-tap; the server
  // keeps the running record, and the refetch after the last tap puts its start back and brings the rule.) `id` after the spread: the placeholder row must never carry the previous row's id into a correction.
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
  context.confirmed.isRecorded = true
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
 * Starts a new session of taps when the cache is cleared or reset for another account (sign-in, sign-out, {@link useAccountScope}):
 * a tap of the old session that is answered late then confirms into its own session's state, never into the one the new account's
 * refused taps fall back to, and leaves the refetch to the new session ({@link isLastTap}).
 * @param client - The app's query client, right after `clear()` or `resetQueries()`.
 * @example queryClient.clear(); forgetConfirmedTaps(queryClient)
 */
export function forgetConfirmedTaps(client: QueryClient): void {
  confirmedStates.delete(client)
}

/**
 * Whether a settling tap is the last of its burst, for {@link useSwitchTo}'s refetch: an earlier tap's refetch would replace the
 * queued taps' rows (their `onMutate` has already run), so only the last tap refetches. A tap of a session that has since been
 * forgotten never does: `clear()` drops it from the mutation cache, so the count would miss it and its refetch would land over the
 * new account's pick.
 * @param client - The app's query client.
 * @param context - What {@link placeTap} returned for this tap; undefined when `onMutate` threw and nothing was placed.
 * @returns
 * - `true` when this tap belongs to the current session and no other tap is waiting or running
 * - `false` otherwise
 * @example if (!isLastTap(queryClient, context)) return
 */
export const isLastTap = (
  client: QueryClient,
  context: TapContext | undefined,
): boolean =>
  context !== undefined &&
  context.confirmed === confirmedStates.get(client) &&
  tapsInFlight(client) <= 1

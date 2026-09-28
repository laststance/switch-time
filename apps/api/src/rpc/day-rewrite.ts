import { ORPCError } from '@orpc/server'

/** A [start, end) span in epoch ms. */
type Span = { start: number; end: number }

/** A row that names the activity it runs. */
type Activity = { activityId: string | null }

/**
 * The part of a day a `replaceDay` rewrites: the whole day, or the `range` the client named (the changed rows of a busy day's
 * 「元に戻す」). Called by `replaceDay` before it takes the user's lock.
 * @param window - The day's [start, end) in the zone the client sent.
 * @param range - The client's `range` (`from` inclusive, `to` exclusive), if it sent one.
 * @returns The span whose rows are deleted and written again.
 * @throws ORPCError BAD_REQUEST when the range is not inside the day.
 * @example rewriteSpan(window, { from: nineOClock, to: tenOClock }) // { start: nineOClock.getTime(), end: tenOClock.getTime() }
 */
export function rewriteSpan(
  window: Span,
  range: { from: Date; to: Date } | undefined,
): Span {
  if (!range) return window
  const span = { start: range.from.getTime(), end: range.to.getTime() }
  if (span.start < window.start || span.end > window.end)
    throw new ORPCError('BAD_REQUEST', {
      message: 'range must fall inside the day',
    })
  return span
}

/**
 * What a rewrite of `span` means for the two records around it, read under the user's lock. Called by `replaceDay`.
 * @param current - The day's own rows now, oldest first.
 * @param span - {@link rewriteSpan}'s answer; the rows outside it are left as they are.
 * @param rows - The rows written in place of the ones inside `span`, oldest first.
 * @param carriedOut - The first switch after the day, if any: while there is one, no row of the day becomes the current state.
 * @param carriedIn - The record carried into the day, if any.
 * @returns
 * - `latest`: the record that becomes the current state (the day's last row, or once emptied the row before the span, or the
 *   carried-in record), whose activity must be live; null when the write leaves a later switch, or a row after the span,
 *   as the current state
 * - `bumpCarriedIn`: whether the carried-in record ends at a different row, which happens only when the write reaches the
 *   day's first row (no row of the day starts before the span)
 * @example rewritePlan(current, span, [], null, carriedIn) // { latest: carriedIn, bumpCarriedIn: true } for a whole-day rewrite to nothing
 */
export function rewritePlan<
  Kept extends Activity & { startedAt: Date },
  Written extends Activity,
  Carried extends Activity,
>(
  current: readonly Kept[],
  span: Span,
  rows: readonly Written[],
  carriedOut: unknown,
  carriedIn: Carried | null,
): { latest: Kept | Written | Carried | null; bumpCarriedIn: boolean } {
  const leading = current.filter((row) => row.startedAt.getTime() < span.start)
  const hasTrailing = current.some((row) => row.startedAt.getTime() >= span.end)
  return {
    latest:
      carriedOut || hasTrailing
        ? null
        : (rows.at(-1) ?? leading.at(-1) ?? carriedIn),
    bumpCarriedIn: carriedIn !== null && leading.length === 0,
  }
}

/** What a web sheet's keydown does with Tab: move focus to this index among the dialog's controls, or leave Tab to the browser. */
export type TrappedFocus = number | 'browser'

/**
 * Keeps Tab inside an open sheet on the web: past the last control it wraps to the first, before the first to the last, and
 * from anywhere else (the dialog itself, a control underneath) it enters the dialog. Called by {@link Sheet}'s keydown.
 * @param count - How many focusable controls the dialog holds.
 * @param activeIndex - The focused control's index among them, -1 when focus is on none of them.
 * @param backwards - Shift+Tab.
 * @returns
 * - the index to focus when Tab would leave the dialog or focus is not on one of its controls
 * - 'browser' when Tab moves between two of the dialog's controls, or there is none to move to
 * @example trappedFocus(3, 2, false) // 0
 * @example trappedFocus(3, 1, false) // 'browser'
 */
export function trappedFocus(
  count: number,
  activeIndex: number,
  backwards: boolean,
): TrappedFocus {
  if (count === 0) return 'browser'
  const last = count - 1
  // Focus on the dialog itself (where a sheet opens) or outside it: enter at the end Tab heads for.
  if (activeIndex === -1) return backwards ? last : 0
  if (backwards && activeIndex === 0) return last
  if (!backwards && activeIndex === last) return 0
  return 'browser'
}

// The keyboard-focus and pressed looks every tap target shares, drawn in the pen file's 「Control の押下とフォーカス」 board.
// On web `:focus-visible` matches keyboard focus only (never a mouse click), and `outline` follows the element's own corners.

/** A 2 px `ink` ring 2 px outside the element; `ink` flips with the theme, so it shows in both. */
export const FOCUS_RING =
  'focus-visible:outline-ink focus-visible:outline-2 focus-visible:outline-offset-2'

/** The same ring drawn inside the element, for a row whose parent clips (or crowds) what lies outside it. */
export const FOCUS_RING_INSET =
  'focus-visible:outline-ink focus-visible:outline-2 focus-visible:-outline-offset-2'

/** 70 % opacity while pressed. */
const PRESSED = 'active:opacity-70'

/**
 * The opacity a tap target shows: 40 % while its action is impossible or a request runs, 70 % while it is pressed.
 * On web `:active` matches a disabled element too, so the pressed look is added only while the target can be pressed.
 * Called by every Pressable that takes {@link FOCUS_RING} or {@link FOCUS_RING_INSET}, with {@link Control} among them.
 * @param disabled - Whether the target is dimmed and inert.
 * @param dimmedByParent - Whether a parent already dims the whole group while it is disabled, as {@link Segmented} does, so a
 * disabled target adds nothing (dimming both would show it at 16 %).
 * @returns The class that dims a disabled target, or the one that answers a press; empty for a disabled target its parent dims.
 * @example pressLook(true) // 'opacity-40'
 * @example pressLook(false) // 'active:opacity-70'
 * @example pressLook(true, true) // ''
 */
export function pressLook(disabled: boolean, dimmedByParent = false): string {
  if (!disabled) return PRESSED
  return dimmedByParent ? '' : 'opacity-40'
}

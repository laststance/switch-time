type KeyLike = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  /** True for the auto-repeat keydowns of a held key. */
  repeat?: boolean
}

// A modifier combo (⌘1 switches browser tabs) is the browser's, never ours.
const plain = (event: KeyLike): boolean =>
  !(event.metaKey || event.ctrlKey || event.altKey)

/**
 * Index of the activity a Home keydown picks: digit keys by position (the menubar's ⌘1–6, never stored); -1 for any other key or a modifier combo.
 * @example activities[hotkeyIndex(event)]
 */
export function hotkeyIndex(event: KeyLike): number {
  return plain(event) ? Number(event.key) - 1 : -1
}

/**
 * Whether a Home keydown starts detox: the plain `0`, the web counterpart of the menubar's ⌘0.
 * @example if (isDetoxHotkey(event)) pick(null)
 */
export const isDetoxHotkey = (event: KeyLike): boolean =>
  plain(event) && event.key === '0'

/**
 * What a keydown on Home or the first-launch screen picks, for {@link useSwitchHotkeys}. A held key's repeats pick nothing, so
 * holding a digit on the first-launch screen sends one first tap, not one per repeat before Home takes over.
 * @param event - The keydown.
 * @param activities - The switch buttons' activities, in the order they are shown.
 * @returns
 * - the activity id at the digit's position
 * - `null` for detox (`0`)
 * - `undefined` when the key picks nothing (another key, a modifier combo, a repeat, a digit past the last button)
 * @example hotkeyPick({ key: '2', metaKey: false, ctrlKey: false, altKey: false }, [{ id: 'a' }, { id: 'b' }]) // 'b'
 */
export function hotkeyPick(
  event: KeyLike,
  activities: readonly { id: string }[],
): string | null | undefined {
  if (event.repeat === true) return undefined
  if (isDetoxHotkey(event)) return null
  return activities[hotkeyIndex(event)]?.id
}

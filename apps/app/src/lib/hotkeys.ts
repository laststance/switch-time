type KeyLike = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
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

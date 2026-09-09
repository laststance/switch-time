type KeyLike = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

/**
 * Index of the activity a Home keydown picks: digit keys by position (the menubar's ⌘1–6, never stored); -1 for any other key or a modifier combo.
 * @example activities[hotkeyIndex(event)]
 */
export function hotkeyIndex(event: KeyLike): number {
  if (event.metaKey || event.ctrlKey || event.altKey) return -1
  return Number(event.key) - 1
}

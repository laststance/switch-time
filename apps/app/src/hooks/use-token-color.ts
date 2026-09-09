import { Platform } from 'react-native'
import { useCSSVariable } from 'uniwind'

/**
 * A colour token as a JS value for native props that cannot take a className (SVG strokes, later activity rings); re-renders on theme flips.
 * On web it returns `undefined` on purpose: `currentColor` inherits the parent's `text-*` class there, which follows the theme live; the JS value was still one render stale right after a flip in screenshots.
 * @example const ink = useTokenColor('ink')
 */
export function useTokenColor(token: 'ink' | 'sub'): string | undefined {
  const value = useCSSVariable(`--color-${token}`)
  if (Platform.OS === 'web') return undefined
  // Colour variables are strings on both platforms; the number side of the type is for lengths.
  return typeof value === 'string' ? value : undefined
}

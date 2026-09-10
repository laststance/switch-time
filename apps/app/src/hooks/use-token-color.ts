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

type Token = 'ink' | 'sub' | 'line' | 'face'

/**
 * Several tokens as JS values on every platform, for a drawing that re-renders anyway (the dial ticks each second, so the web probe lag {@link useTokenColor} avoids is invisible).
 * @example const tone = useTokenColors(['ink', 'line']); tone.ink
 */
export function useTokenColors<const T extends readonly Token[]>(
  tokens: T,
): Record<T[number], string> {
  const values = useCSSVariable(tokens.map((token) => `--color-${token}`))
  return Object.fromEntries(
    tokens.map((token, index) => [token, String(values[index])]),
  ) as Record<T[number], string>
}

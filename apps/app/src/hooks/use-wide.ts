import { useWindowDimensions } from 'react-native'

/**
 * Whether the window is wide enough for the design's side rail and bordered content column (800 px and up, ST Web).
 * @example const wide = useWide()
 */
export function useWide() {
  return useWindowDimensions().width >= 800
}

import { Text } from 'react-native'

import { useAppSelector } from '@/store'

/**
 * ホーム's refusal line (`ST Phone / ホーム・拒否の行`): under the detox row, why the last tap or digit key was refused
 * ({@link homeSlice}), on ホーム and on the first-launch screen a refused first tap goes back to. Nothing while no tap was refused.
 * Keyed by its text, so a second refusal with other words is announced again.
 * @example <DetoxRow … /><TapRefusalLine />
 */
export function TapRefusalLine() {
  const refusal = useAppSelector((s) => s.home.tapRefusal)
  if (refusal === null) return null
  return (
    <Text
      key={refusal}
      role="alert"
      className="text-ink w-full text-center text-xs leading-4.5 font-medium"
    >
      {refusal}
    </Text>
  )
}

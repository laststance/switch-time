import { View } from 'react-native'

import { StrokeIcon } from '@/components/stroke-icon'
import { useTokenColor } from '@/hooks/use-token-color'
import { activityIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type ActivityChipProps = {
  /** The activity's persisted palette colour: data from the API, never a theme token. Null is detox: outlined, glyph in ink. */
  color: string | null
  iconKey: string
  size: number
  iconSize: number
}

/**
 * The activity's glyph on a rounded square of its own colour: 26 px in the 状態別 list, 32 px on a correction row. Detox has no
 * colour, so its chip is a dashed `line` frame with the glyph in ink.
 * @example <ActivityChip color="#3B7BD9" iconKey="work" size={32} iconSize={18} />
 */
export function ActivityChip({
  color,
  iconKey,
  size,
  iconSize,
}: ActivityChipProps) {
  const ink = useTokenColor('ink')
  const look =
    color === null
      ? {
          root: 'border border-dashed border-line text-ink',
          fill: undefined,
          glyph: ink,
        }
      : { root: '', fill: { backgroundColor: color }, glyph: '#fff' }
  return (
    <View
      className={cn('items-center justify-center rounded-chip', look.root)}
      style={{ width: size, height: size, ...look.fill }}
    >
      <StrokeIcon
        d={activityIcon(iconKey)}
        size={iconSize}
        strokeWidth={2}
        color={look.glyph}
      />
    </View>
  )
}

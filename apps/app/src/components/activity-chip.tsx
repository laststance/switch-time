import { View } from 'react-native'

import { StrokeIcon } from '@/components/stroke-icon'
import { activityIcon } from '@/lib/icons'

type ActivityChipProps = {
  /** The activity's persisted palette colour: data from the API, never a theme token. */
  color: string
  iconKey: string
  size: number
  iconSize: number
}

/**
 * The activity's glyph on a rounded square of its own colour: 26 px in the 状態別 list, 32 px on a correction row.
 * @example <ActivityChip color="#3B7BD9" iconKey="work" size={32} iconSize={18} />
 */
export function ActivityChip({
  color,
  iconKey,
  size,
  iconSize,
}: ActivityChipProps) {
  return (
    <View
      className="items-center justify-center rounded-chip"
      style={{ width: size, height: size, backgroundColor: color }}
    >
      <StrokeIcon
        d={activityIcon(iconKey)}
        size={iconSize}
        strokeWidth={2}
        color="#fff"
      />
    </View>
  )
}

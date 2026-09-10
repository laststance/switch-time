import { Pressable, Text } from 'react-native'

import { StrokeIcon } from '@/components/stroke-icon'
import { useTokenColor } from '@/hooks/use-token-color'
import { activityIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type ActivityPillProps = {
  name: string
  /** The activity's persisted palette colour: data from the API, never a theme token. */
  color: string
  iconKey: string
  selected: boolean
  disabled: boolean
  onPress: () => void
}

/**
 * One option of the 「活動を変える」 picker: a 38 px pill that fills with the activity's colour when it is the row's state.
 * @example <ActivityPill name="仕事" color="#3B7BD9" iconKey="work" selected={false} disabled={pending} onPress={pick} />
 */
export function ActivityPill({
  name,
  color,
  iconKey,
  selected,
  disabled,
  onPress,
}: ActivityPillProps) {
  const ink = useTokenColor('ink')
  // The chosen pill fills with the activity's colour and inverts its ink: one decision for the border, the glyph and the label.
  const look = selected
    ? { pill: { backgroundColor: color, borderColor: color }, ink: '#fff' }
    : { pill: null, ink }
  return (
    <Pressable
      role="radio"
      aria-checked={selected}
      aria-label={name}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'h-[38px] flex-row items-center gap-1.5 rounded-pill border border-line px-3.5',
        disabled && 'opacity-40',
      )}
      style={look.pill}
    >
      <StrokeIcon
        d={activityIcon(iconKey)}
        size={15}
        strokeWidth={2}
        color={look.ink}
      />
      <Text className="text-xs font-semibold" style={{ color: look.ink }}>
        {name}
      </Text>
    </Pressable>
  )
}

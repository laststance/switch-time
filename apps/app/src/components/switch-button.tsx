import { Pressable, Text } from 'react-native'

import { StrokeIcon } from '@/components/stroke-icon'
import { useTokenColor } from '@/hooks/use-token-color'
import { activityIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type Props = {
  name: string
  /** The activity's persisted palette colour: data from the API, never a theme token. */
  color: string
  iconKey: string
  active: boolean
  /** Icon colour when inactive; the first-launch row tints each glyph with its own activity colour. */
  tint?: string
  onPress: () => void
}

/**
 * One activity switch: 150 px basis that wraps to 3 per row in the 640 px column and 2 on a phone. Exactly one in the row is
 * active and fills with its own colour; that is the whole state, no glow, no elevation (design rule). Inactive is `surface` + `line`.
 * @example <SwitchButton name="仕事" color="#3B7BD9" iconKey="work" active onPress={() => switchTo.mutate({ activityId })} />
 */
export function SwitchButton({
  name,
  color,
  iconKey,
  active,
  tint,
  onPress,
}: Props) {
  const ink = useTokenColor('ink')
  // The active colour comes from data, so it is a style value rather than a class; the label goes white on it.
  const look = active
    ? {
        root: 'text-white',
        label: 'text-white',
        icon: '#fff',
        style: { backgroundColor: color, borderColor: color },
      }
    : {
        root: 'border-line bg-surface text-ink',
        label: 'text-ink',
        icon: tint ?? ink,
        style: undefined,
      }
  return (
    <Pressable
      role="button"
      aria-selected={active}
      onPress={onPress}
      className={cn(
        'h-[60px] shrink grow basis-[150px] flex-row items-center justify-center gap-2 rounded-chip border',
        look.root,
      )}
      style={look.style}
    >
      <StrokeIcon
        d={activityIcon(iconKey)}
        size={20}
        strokeWidth={2}
        color={look.icon}
      />
      <Text className={cn('text-sm font-semibold', look.label)}>{name}</Text>
    </Pressable>
  )
}

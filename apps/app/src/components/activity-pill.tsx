import { Pressable, Text } from 'react-native'

import { StrokeIcon } from '@/components/stroke-icon'
import { useTokenColor } from '@/hooks/use-token-color'
import { activityIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type ActivityPillProps = {
  name: string
  /** The activity's persisted palette colour: data from the API, never a theme token. Null is the detox option. */
  color: string | null
  iconKey: string
  selected: boolean
  disabled: boolean
  onPress: () => void
}

/**
 * One option of the 「活動を変える」 picker: a 38 px pill that fills with the activity's colour when it is the row's state; the
 * detox option, which has no colour, inverts to `ink` on `bg` instead (the same look as the detox row on ホーム).
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
  const bg = useTokenColor('bg')
  // One decision for the border, the fill, the glyph and the label.
  const look = !selected
    ? {
        root: 'border-line text-ink',
        label: 'text-ink',
        style: null,
        glyph: ink,
      }
    : color === null
      ? {
          root: 'border-ink bg-ink text-bg',
          label: 'text-bg',
          style: null,
          glyph: bg,
        }
      : {
          root: 'text-white',
          label: 'text-white',
          style: { backgroundColor: color, borderColor: color },
          glyph: '#fff',
        }
  return (
    <Pressable
      role="radio"
      aria-checked={selected}
      aria-label={name}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'h-[38px] flex-row items-center gap-1.5 rounded-pill border px-3.5',
        look.root,
        disabled && 'opacity-40',
      )}
      style={look.style}
    >
      <StrokeIcon
        d={activityIcon(iconKey)}
        size={15}
        strokeWidth={2}
        color={look.glyph}
      />
      <Text className={cn('text-xs font-semibold', look.label)}>{name}</Text>
    </Pressable>
  )
}

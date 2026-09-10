import { Pressable, Text } from 'react-native'

import { StrokeIcon } from '@/components/stroke-icon'
import { useTokenColor } from '@/hooks/use-token-color'
import { cn } from '@/lib/utils'

const HOME_ICON = 'M3 11 12 3l9 8v10H3z'

// Activity glyphs from the design (ST Web ICONS), keyed by `activities.iconKey`.
const ICONS: Record<string, string> = {
  home: HOME_ICON,
  work: 'M3 8h18v12H3zM9 8V5h6v3M3 13h18',
  rest: 'M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM16 11h2a2 2 0 0 1 0 4h-2M7 3v3M11 3v3',
  sleep: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  meal: 'M7 3v18M4 3v5a3 3 0 0 0 6 0V3M16 3c-2 2-2 8 0 10v8M16 13c2-2 3-6 2-10',
  fun: 'M6 8h12a4 4 0 0 1 4 4v3a3 3 0 0 1-5.5 1.5L15 15H9l-1.5 1.5A3 3 0 0 1 2 15v-3a4 4 0 0 1 4-4zM7 11v3M5.5 12.5h3M16 12h.01M18 13.5h.01',
}

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
      // aria-selected is only valid on option / tab / row-like roles; a toggle button reports its state with aria-pressed.
      aria-pressed={active}
      onPress={onPress}
      className={cn(
        'h-[60px] shrink grow basis-[150px] flex-row items-center justify-center gap-2 rounded-chip border',
        look.root,
      )}
      style={look.style}
    >
      <StrokeIcon
        d={ICONS[iconKey] ?? HOME_ICON}
        size={20}
        strokeWidth={2}
        color={look.icon}
      />
      <Text className={cn('text-sm font-semibold', look.label)}>{name}</Text>
    </Pressable>
  )
}

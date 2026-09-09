import type { ActivityColor } from '@switch-time/shared'
import { Pressable, Text } from 'react-native'

import { cn } from '@/lib/utils'

type Props = {
  name: string
  /** The activity's persisted palette colour: data from the API, never a theme token. */
  color: ActivityColor
  active: boolean
  onPress: () => void
}

/**
 * One activity switch. Exactly one in the row is active and fills with its own colour; that is the whole state,
 * no glow, no elevation (design rule). Inactive buttons are `surface` with a `line` border.
 * @example <SwitchButton name="仕事" color="#3B7BD9" active onPress={() => switchTo(id)} />
 */
export function SwitchButton({ name, color, active, onPress }: Props) {
  return (
    <Pressable
      role="button"
      aria-selected={active}
      onPress={onPress}
      className={cn(
        'flex-row items-center justify-center gap-2 rounded-chip border px-4 py-3',
        !active && 'border-line bg-surface',
      )}
      // The active colour comes from data, so it is a style value rather than a class.
      style={
        active ? { backgroundColor: color, borderColor: color } : undefined
      }
    >
      <Text
        className={cn(
          'text-sm font-medium',
          active ? 'text-white' : 'text-ink',
        )}
      >
        {name}
      </Text>
    </Pressable>
  )
}

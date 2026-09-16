import { Pressable, Text } from 'react-native'

import { StrokeIcon } from '@/components/stroke-icon'
import { useTokenColor } from '@/hooks/use-token-color'
import { WIND } from '@/lib/icons'
import { cn } from '@/lib/utils'

type Props = {
  active: boolean
  onPress: () => void
}

/**
 * The full-width row under the switch grid that records the time to no activity. Pressed, it inverts to `ink` on `bg` (the
 * design's "no colour = no activity"); otherwise it reads like an unpressed switch. It reports its state with aria-pressed like
 * {@link SwitchButton}, so exactly one of the switch buttons and this row is pressed at any moment.
 * @example <DetoxRow active={current.activityId === null} onPress={() => pick(null)} />
 */
export function DetoxRow({ active, onPress }: Props) {
  const ink = useTokenColor('ink')
  const bg = useTokenColor('bg')
  const look = active
    ? {
        root: 'border-ink bg-ink text-bg',
        label: 'text-bg',
        hint: 'text-bg',
        icon: bg,
      }
    : {
        root: 'border-line bg-surface text-ink',
        label: 'text-ink',
        hint: 'text-sub',
        icon: ink,
      }
  return (
    <Pressable
      role="button"
      aria-pressed={active}
      onPress={onPress}
      className={cn(
        'h-12 w-full flex-row items-center justify-center gap-[9px] rounded-chip border px-4',
        look.root,
      )}
    >
      <StrokeIcon d={WIND} size={20} strokeWidth={2} color={look.icon} />
      <Text className={cn('text-sm font-semibold', look.label)}>detox</Text>
      <Text className={cn('text-xs', look.hint)}>どの行動にも記録しない</Text>
    </Pressable>
  )
}

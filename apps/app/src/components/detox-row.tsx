import { Pressable, Text } from 'react-native'

import { StrokeIcon } from '@/components/stroke-icon'
import { useTokenColor } from '@/hooks/use-token-color'
import { DETOX } from '@/lib/detox'
import { activityIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type Props = {
  active: boolean
  /** Detox runs past its run's measured week, so a press starts a new run ({@link detoxRenewable}); the hint says so. */
  renewable?: boolean
  onPress: () => void
}

/**
 * The full-width row under the switch buttons that records the time to no activity. Pressed, it inverts to `ink` on `bg` (the
 * design's "no colour = no activity"); otherwise it reads like an unpressed switch. It reports its state with aria-pressed like
 * {@link SwitchButton}, so on Home exactly one of the switch buttons and this row is pressed at any moment ({@link FirstLaunch}
 * shows it unpressed under unpressed buttons, since nothing runs yet). While `renewable`, the hint
 * reads 「押し直すと新しく始まります」 (the row stays pressed).
 * @example <DetoxRow active={current.activityId === null} renewable={renewable} onPress={() => pick(null)} />
 */
export function DetoxRow({ active, renewable = false, onPress }: Props) {
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
        'h-12 w-full flex-row items-center justify-center gap-2.25 rounded-chip border px-4',
        look.root,
      )}
    >
      <StrokeIcon
        d={activityIcon(DETOX.iconKey)}
        size={20}
        strokeWidth={2}
        color={look.icon}
      />
      <Text className={cn('text-sm font-semibold', look.label)}>
        {DETOX.name}
      </Text>
      <Text className={cn('text-xs', look.hint)}>
        {renewable ? '押し直すと新しく始まります' : 'どの行動にも記録しない'}
      </Text>
    </Pressable>
  )
}

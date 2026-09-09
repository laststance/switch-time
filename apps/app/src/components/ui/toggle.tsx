import { Pressable, View } from 'react-native'

import { cn } from '@/lib/utils'

type ToggleProps = {
  /** The accessible name; the row's own text is not linked to the control. */
  label: string
  value: boolean
  onChange: (value: boolean) => void
}

/**
 * The design's 52 × 30 pill switch (`accent` when on, `chip` when off, white thumb) as a `role="switch"` Pressable, so web and native draw the same control in token colours and tests find it by its label.
 * @example <Toggle label="秒針を表示" value={settings.showSecondHand} onChange={(showSecondHand) => update.mutate({ showSecondHand })} />
 */
export function Toggle({ label, value, onChange }: ToggleProps) {
  return (
    <Pressable
      role="switch"
      aria-checked={value}
      aria-label={label}
      onPress={() => onChange(!value)}
      className={cn(
        'h-[30px] w-[52px] justify-center rounded-pill px-0.5',
        value ? 'items-end bg-accent' : 'items-start bg-chip',
      )}
    >
      <View className="h-[26px] w-[26px] rounded-pill bg-white" />
    </Pressable>
  )
}

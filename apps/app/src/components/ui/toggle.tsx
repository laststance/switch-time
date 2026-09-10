import { Pressable, View } from 'react-native'

import { cn } from '@/lib/utils'

type ToggleProps = {
  /** The accessible name; the row's own text is not linked to the control. */
  label: string
  value: boolean
  /** While the stored value is still unknown the control shows a default, and a press would write that default back. */
  disabled?: boolean
  onChange: (value: boolean) => void
}

/**
 * The design's 52 × 30 pill switch (`accent` when on, `chip` when off, white thumb) as a `role="switch"` Pressable, so web and native draw the same control in token colours and tests find it by its label.
 * @example <Toggle label="秒針を表示" value={settings.showSecondHand} onChange={(showSecondHand) => update.mutate({ showSecondHand })} />
 */
export function Toggle({
  label,
  value,
  disabled = false,
  onChange,
}: ToggleProps) {
  return (
    <Pressable
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onPress={() => onChange(!value)}
      // RN-web only presses on Space for the button role; a switch must answer it itself (and keep the page from scrolling).
      onKeyDown={(event) => {
        if (disabled || event.nativeEvent.key !== ' ') return
        event.preventDefault()
        onChange(!value)
      }}
      className={cn(
        'h-[30px] w-[52px] justify-center rounded-pill px-0.5',
        value ? 'items-end bg-accent' : 'items-start bg-chip',
        disabled && 'opacity-40',
      )}
    >
      <View className="h-[26px] w-[26px] rounded-pill bg-white" />
    </Pressable>
  )
}

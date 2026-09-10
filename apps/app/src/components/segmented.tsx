import { Pressable, Text, View } from 'react-native'

import { cn } from '@/lib/utils'

type Option<T> = { value: T; label: string }
type SegmentedProps<T extends string | number> = {
  /** The group's accessible name (screen readers and Playwright find the buttons under it). */
  label: string
  options: readonly Option<T>[]
  value: T
  /** Stretch the segments across the row (the idle picker); off, each takes its label's width (外観). */
  grow?: boolean
  /** While the stored value is still unknown the control shows a default, and a press would write that default back. */
  disabled?: boolean
  onChange: (value: T) => void
}

/**
 * The design's segmented control (a `chip` trough, the chosen segment raised on `surface`): 外観 on 設定 and 無操作とみなす時間 on the excluded-days sheet.
 * @example <Segmented label="外観" options={THEME_OPTIONS} value={settings.theme} onChange={(theme) => update.mutate({ theme })} />
 */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  grow = false,
  disabled = false,
  onChange,
}: SegmentedProps<T>) {
  return (
    <View
      role="group"
      aria-label={label}
      className={cn(
        'flex-row gap-[3px] rounded-chip bg-chip p-[3px]',
        disabled && 'opacity-40',
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        // Toggle buttons rather than radios: RN-web only presses on Space for the button role, and radios would owe arrow keys.
        return (
          <Pressable
            key={option.value}
            role="button"
            aria-pressed={selected}
            disabled={disabled}
            aria-label={option.label}
            // Re-picking the chosen option is a no-op (it would otherwise write and refetch every total for nothing).
            onPress={() => {
              if (!selected) onChange(option.value)
            }}
            className={cn(
              'h-8 min-w-14 items-center justify-center rounded-chip px-3',
              grow && 'flex-1',
              selected && 'bg-surface',
            )}
          >
            <Text
              className={cn(
                'text-xs font-semibold',
                selected ? 'text-ink' : 'text-sub',
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

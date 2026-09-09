import { Pressable, Text, View } from 'react-native'

import { cn } from '@/lib/utils'

type Option<T> = { value: T; label: string }
type SegmentedProps<T extends string | number> = {
  /** The group's accessible name (screen readers and Playwright find the radios under it). */
  label: string
  options: readonly Option<T>[]
  value: T
  /** Stretch the segments across the row (the idle picker); off, each takes its label's width (外観). */
  grow?: boolean
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
  onChange,
}: SegmentedProps<T>) {
  return (
    <View
      role="radiogroup"
      aria-label={label}
      className="flex-row gap-[3px] rounded-chip bg-chip p-[3px]"
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            onPress={() => onChange(option.value)}
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

import type { TabTriggerSlotProps } from 'expo-router/ui'
import { Pressable, Text, View } from 'react-native'

import { StrokeIcon } from '@/components/stroke-icon'
import { useTokenColor } from '@/hooks/use-token-color'
import { cn } from '@/lib/utils'

// Nav glyphs straight from the design (ST Web NAV_ICONS).
const NAV_ICONS = {
  now: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 12l1.5-1-1.2-2.8-1.8.4-1.6-1.2.1-1.9L14.3 4l-1.2 1.4h-2L9.9 4 7.2 5.5l.1 1.9-1.6 1.2-1.8-.4L2.7 11 4.2 12l-1.5 1 1.2 2.8 1.8-.4 1.6 1.2-.1 1.9 2.7 1.5 1.2-1.4h2l1.2 1.4 2.7-1.5-.1-1.9 1.6-1.2 1.8.4L21.5 13z',
}

// Rail items are 60×58 chips that fill when focused; bar items share the width and stay transparent.
const VARIANTS = {
  rail: { item: 'h-[58px] w-[60px]', focused: 'bg-chip' },
  bar: { item: 'flex-1', focused: '' },
}

type NavItemProps = TabTriggerSlotProps & {
  icon: keyof typeof NAV_ICONS
  label: string
  variant: keyof typeof VARIANTS
}

/**
 * One destination for `TabTrigger asChild`: icon + 10 px label, ink with the heavier stroke when focused and sub otherwise.
 * @example <TabTrigger name="index" href="/" asChild><NavItem icon="now" label="ホーム" variant="rail" /></TabTrigger>
 */
export function NavItem({
  icon,
  label,
  variant,
  isFocused = false,
  ...props
}: NavItemProps) {
  const look = isFocused
    ? { tone: 'text-ink', token: 'ink' as const, stroke: 2.4 }
    : { tone: 'text-sub', token: 'sub' as const, stroke: 1.8 }
  const color = useTokenColor(look.token)
  return (
    // TabTrigger hands the Pressable a row `style`; the inner View owns the column layout so nothing fights it.
    <Pressable
      {...props}
      role="tab"
      aria-selected={isFocused}
      className={cn(
        'rounded-chip',
        VARIANTS[variant].item,
        isFocused && VARIANTS[variant].focused,
      )}
    >
      <View
        className={cn(
          'flex-1 items-center justify-center gap-[3px]',
          look.tone,
        )}
      >
        <StrokeIcon
          d={NAV_ICONS[icon]}
          size={24}
          strokeWidth={look.stroke}
          color={color}
        />
        <Text className={cn('text-2xs font-semibold', look.tone)}>{label}</Text>
      </View>
    </Pressable>
  )
}

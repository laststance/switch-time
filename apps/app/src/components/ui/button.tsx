import { Pressable, type PressableProps, Text } from 'react-native'

import { FOCUS_RING, pressLook } from '@/lib/press'
import { cn } from '@/lib/utils'

type ButtonProps = Omit<PressableProps, 'children'> & {
  title: string
  variant?: 'primary' | 'ghost'
}

/**
 * Flat button on the tokens: `primary` fills with `accent`, `ghost` is the chip outline; `disabled` also dims it while a request runs.
 * @example <Button title="サインイン" onPress={submit} disabled={pending} />
 */
export function Button({
  title,
  variant = 'primary',
  disabled,
  className,
  ...props
}: ButtonProps) {
  return (
    <Pressable
      {...props}
      role="button"
      disabled={disabled}
      className={cn(
        FOCUS_RING,
        'h-12 items-center justify-center rounded-chip px-4',
        variant === 'primary' ? 'bg-accent' : 'border-line bg-chip border',
        pressLook(Boolean(disabled)),
        className,
      )}
    >
      <Text
        className={cn(
          'text-sm font-medium',
          variant === 'primary' ? 'text-white' : 'text-ink',
        )}
      >
        {title}
      </Text>
    </Pressable>
  )
}

import { Pressable, type PressableProps, Text } from 'react-native'

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
        'h-12 items-center justify-center rounded-chip px-4',
        variant === 'primary' ? 'bg-accent' : 'border border-line bg-chip',
        disabled && 'opacity-50',
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

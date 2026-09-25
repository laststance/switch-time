import type { PropsWithChildren } from 'react'
import { Pressable } from 'react-native'

import { cn } from '@/lib/utils'

type ControlProps = PropsWithChildren<{
  /** Accessible name when the children are a glyph or a swatch rather than text. */
  label?: string
  disabled: boolean
  onPress: () => void
  className: string
}>

/**
 * A bare tap target (▲▼, the colour dot, ‹ ›, 「元に戻す」, a list row) that dims to 40 % while the action is impossible or a request
 * runs: the one disabled look for everything that is not a {@link Button} or a form control. While pressed it shows 70 %, and a
 * keyboard focus (web `:focus-visible`, never a mouse click) draws a 2 px `ink` ring 2 px outside it.
 * @example <Control label="次の週" disabled={latest} onPress={() => onStep(1)} className="h-9 w-9"><Text>›</Text></Control>
 */
export function Control({
  label,
  disabled,
  onPress,
  className,
  children,
}: ControlProps) {
  return (
    <Pressable
      role="button"
      aria-label={label}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'focus-visible:outline-ink items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2',
        // On web `:active` matches a disabled element too, so the pressed look is added only while it can be pressed.
        disabled ? 'opacity-40' : 'active:opacity-70',
        className,
      )}
    >
      {children}
    </Pressable>
  )
}

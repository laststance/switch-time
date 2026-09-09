import { Text, type TextProps } from 'react-native'

import { cn } from '@/lib/utils'

/**
 * A ticking number (elapsed time, clock). Always tabular figures, so digits do not jitter as they change;
 * defaults to the 52px hero size the Home screen uses (MVP-14).
 * @example <Readout>{formatElapsed(seconds)}</Readout>
 */
export function Readout({ className, ...props }: TextProps) {
  return (
    <Text
      {...props}
      className={cn('tabular text-display text-ink', className)}
    />
  )
}

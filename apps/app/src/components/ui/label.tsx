import { Text, type TextProps } from 'react-native'

import { cn } from '@/lib/utils'

/**
 * Field caption in the `sub` tone, sits above an {@link Input}.
 * @example <Label>メールアドレス</Label>
 */
export function Label({ className, ...props }: TextProps) {
  return <Text {...props} className={cn('text-xs text-sub', className)} />
}

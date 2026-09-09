import { TextInput, type TextInputProps } from 'react-native'

import { cn } from '@/lib/utils'

/**
 * Text field on the tokens (radius 10, `surface` face, `line` border); give it `aria-label` so tests and screen readers find it.
 * @example <Input aria-label="メールアドレス" value={email} onChangeText={setEmail} />
 */
export function Input({ className, ...props }: TextInputProps) {
  return (
    <TextInput
      {...props}
      className={cn(
        'h-12 w-full rounded-chip border border-line bg-surface px-3 text-sm text-ink',
        className,
      )}
    />
  )
}

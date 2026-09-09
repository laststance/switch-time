import { router } from 'expo-router'
import type { PropsWithChildren } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'

import { useEscapeKey } from '@/hooks/use-escape-key'
import { useWide } from '@/hooks/use-wide'
import { cn } from '@/lib/utils'

// Leaves a sheet route: back when it was pushed, home when it was opened by URL or reload.
function dismiss() {
  if (router.canGoBack()) router.back()
  else router.replace('/')
}

type SheetProps = PropsWithChildren<{ title: string; hint: string }>

/**
 * Body of a sheet route: the design's header (title, hint, ✕) over the content; wide web adds the scrim and centres it as a dialog, native relies on the Stack's modal presentation.
 * @example <Sheet title="今日の記録を訂正" hint="行をタップ → 開始時刻を15分ずつ動かす／活動を変える" />
 */
export function Sheet({
  title,
  hint,
  children = <Text className="text-sm text-sub">準備中</Text>,
}: SheetProps) {
  const wide = useWide()
  // Wide web centres the sheet as a dialog over a scrim; phones and narrow web fill the screen (native adds the modal presentation).
  const dialog = Platform.OS === 'web' && wide
  const look = dialog
    ? {
        root: 'items-center justify-center bg-scrim p-6',
        card: 'w-full max-w-[560px] rounded-sheet border border-line bg-sheet-bg p-5',
      }
    : { root: 'bg-sheet-bg', card: 'flex-1 px-5 pb-10 pt-3.5' }
  useEscapeKey(dismiss)
  return (
    <View className={cn('flex-1', look.root)}>
      {dialog && (
        <Pressable
          tabIndex={-1}
          className="absolute inset-0"
          onPress={dismiss}
        />
      )}
      <View
        role="dialog"
        aria-modal
        aria-label={title}
        className={cn('gap-4', look.card)}
      >
        <View className="flex-row items-start gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-lg font-bold text-ink">{title}</Text>
            <Text className="text-xs leading-[18px] text-sub">{hint}</Text>
          </View>
          <Pressable
            role="button"
            aria-label="閉じる"
            className="h-11 w-11 items-center justify-center rounded-pill bg-chip"
            onPress={dismiss}
          >
            <Text className="text-md text-ink">✕</Text>
          </Pressable>
        </View>
        {children}
      </View>
    </View>
  )
}

import { router } from 'expo-router'
import type { PropsWithChildren } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'

import { useInitialFocus } from '@/hooks/use-initial-focus'
import { useWebKeydown } from '@/hooks/use-web-keydown'
import { useWide } from '@/hooks/use-wide'
import { trappedFocus } from '@/lib/focus-trap'
import { FOCUS_RING, pressLook } from '@/lib/press'
import { cn } from '@/lib/utils'

/**
 * Leaves a sheet route: back when it was pushed, home when it was opened by URL or reload (✕, the scrim, Escape, 「完了」).
 * @example <Button title="完了" onPress={dismissSheet} />
 */
export function dismissSheet(): void {
  if (router.canGoBack()) router.back()
  else router.replace('/')
}

// What a keyboard can reach inside the dialog; RN-web renders a Pressable as a div with tabindex 0.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Tab and Shift+Tab stay inside the open sheet (the topmost dialog), so focus never wanders onto the screen underneath.
function keepTabInside(event: KeyboardEvent): void {
  const dialog = [
    ...document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
  ].at(-1)
  if (!dialog) return
  const controls = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
  const activeIndex = controls.findIndex(
    (control) => control === document.activeElement,
  )
  const target = trappedFocus(controls.length, activeIndex, event.shiftKey)
  if (target === 'browser') return
  event.preventDefault()
  controls[target]?.focus()
}

type SheetProps = PropsWithChildren<{ title: string; hint: string }>

/**
 * Body of a sheet route: the design's header (title, hint, ✕) over the content; wide web adds the scrim and centres it as a dialog, native relies on the Stack's modal presentation.
 * @example <Sheet title="今日の記録を訂正" hint="行をタップ → 開始時刻を動かす／区切る／活動を変える" />
 */
export function Sheet({ title, hint, children }: SheetProps) {
  const wide = useWide()
  // Keyboard focus starts inside the dialog rather than on the tabs still in the DOM underneath.
  const dialogRef = useInitialFocus()
  // Wide web centres the sheet as a dialog over a scrim; phones and narrow web fill the screen (native adds the modal presentation).
  const dialog = Platform.OS === 'web' && wide
  const look = dialog
    ? {
        root: 'items-center justify-center bg-scrim p-6',
        card: 'max-h-full w-full max-w-[560px] rounded-sheet border border-line bg-sheet-bg p-5',
      }
    : { root: 'bg-sheet-bg', card: 'flex-1 px-5 pb-10 pt-3.5' }
  // Captured, so Escape and Tab pressed in a text field (whose TextInput stops the keydown) still reach the sheet.
  useWebKeydown(
    (event) => {
      // Escape while an IME is composing (a search in Japanese) cancels the composition, not the sheet.
      // Focus moves to the dialog before it closes, as a click on ✕ takes it, so a field that saves when it loses focus (an
      // activity's name) keeps what was typed.
      if (event.key === 'Escape' && !event.isComposing) {
        dialogRef.current?.focus()
        dismissSheet()
      }
      if (event.key === 'Tab') keepTabInside(event)
    },
    { capture: true },
  )
  return (
    <View className={cn('flex-1', look.root)}>
      {dialog && (
        <Pressable
          tabIndex={-1}
          className="absolute inset-0"
          onPress={dismissSheet}
        />
      )}
      <View
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal
        aria-label={title}
        className={cn('gap-4', look.card)}
      >
        <View className="flex-row items-start gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-ink text-lg font-bold">{title}</Text>
            <Text className="text-sub text-xs leading-4.5">{hint}</Text>
          </View>
          <Pressable
            role="button"
            aria-label="閉じる"
            className={cn(
              FOCUS_RING,
              pressLook(false),
              'bg-chip h-11 w-11 items-center justify-center rounded-pill',
            )}
            onPress={dismissSheet}
          >
            <Text className="text-ink text-md">✕</Text>
          </Pressable>
        </View>
        {children}
      </View>
    </View>
  )
}

import type { PropsWithChildren } from 'react'
import { ScrollView, View } from 'react-native'

import { useWide } from '@/hooks/use-wide'
import { cn } from '@/lib/utils'

/**
 * Content column from the design: fills the tab slot and scrolls; centred at 640 px with side rules when wide, edge to edge below.
 * @example <Screen><ScreenHeader title="いま" /></Screen>
 */
export function Screen({ children }: PropsWithChildren) {
  const wide = useWide()
  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center' }}
    >
      <View
        className={cn(
          'w-full max-w-[640px] flex-1 gap-4',
          wide ? 'border-x border-line px-6 pb-8 pt-6' : 'px-4 pb-6 pt-4',
        )}
      >
        {children}
      </View>
    </ScrollView>
  )
}

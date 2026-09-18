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
      className="bg-bg flex-1"
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center' }}
    >
      <View
        className={cn(
          // grow fills a short page so the wide side-rules reach the tab; shrink-0 keeps the column as tall as its children so the ScrollView can move.
          'w-full max-w-160 shrink-0 grow gap-4',
          wide ? 'border-line border-x px-6 pt-6 pb-8' : 'px-4 pt-4 pb-6',
        )}
      >
        {children}
      </View>
    </ScrollView>
  )
}

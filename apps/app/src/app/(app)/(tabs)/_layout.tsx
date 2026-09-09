import { TabList, Tabs, TabSlot, TabTrigger } from 'expo-router/ui'
import { View } from 'react-native'

import { NavItem } from '@/components/nav-item'
import { StrokeIcon } from '@/components/stroke-icon'
import { useTokenColor } from '@/hooks/use-token-color'
import { useWide } from '@/hooks/use-wide'
import { cn } from '@/lib/utils'

// Everything that differs between the 76 px rail (800 px and up) and the 60 px bottom bar.
// TabList's own style is a row, so the rail's column layout goes through `style`, which wins over classes.
const CHROME = {
  rail: {
    root: 'flex-row',
    list: 'w-[76px] items-center gap-1.5 border-r py-4',
    layout: { flexDirection: 'column', justifyContent: 'flex-start' },
  },
  bar: {
    root: 'flex-col-reverse',
    list: 'h-[60px] border-t',
    layout: undefined,
  },
} as const

// The design's two navigation chromes on one headless Tabs.
export default function TabsLayout() {
  const variant = useWide() ? 'rail' : 'bar'
  const chrome = CHROME[variant]
  const ink = useTokenColor('ink')
  return (
    <Tabs asChild>
      <View className={cn('flex-1 bg-bg', chrome.root)}>
        <TabList asChild style={chrome.layout}>
          <View
            role="tablist"
            className={cn('border-line bg-tab-bg', chrome.list)}
          >
            {/* Rail badge: MVP-14 paints the ring with the current activity's colour. */}
            {variant === 'rail' && (
              <View className="mb-3.5 h-9 w-9 items-center justify-center rounded-pill border-[3px] border-line bg-face text-ink">
                <StrokeIcon
                  d="M12 7v5l3.5 2"
                  size={18}
                  strokeWidth={2.4}
                  color={ink}
                />
              </View>
            )}
            <TabTrigger name="index" href="/" asChild>
              <NavItem icon="now" label="ホーム" variant={variant} />
            </TabTrigger>
            <TabTrigger name="history" href="/history" asChild>
              <NavItem icon="chart" label="記録" variant={variant} />
            </TabTrigger>
            <TabTrigger name="settings" href="/settings" asChild>
              <NavItem icon="gear" label="設定" variant={variant} />
            </TabTrigger>
          </View>
        </TabList>
        <TabSlot />
      </View>
    </Tabs>
  )
}

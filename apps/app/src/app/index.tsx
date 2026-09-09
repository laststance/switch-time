import { DEFAULT_ACTIVITIES } from '@switch-time/shared'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useUniwind } from 'uniwind'

import { Readout } from '@/components/readout'
import { SwitchButton } from '@/components/switch-button'
import { useAppDispatch } from '@/store'
import { preferencesSlice } from '@/store/preferences'

// Placeholder until MVP-13/14 bring the real shell: proves the tokens, the switch row and both bands on web and native.
export default function HomeScreen() {
  const [active, setActive] = useState(0)
  const { theme } = useUniwind()
  const dispatch = useAppDispatch()

  return (
    <View className="flex-1 items-center justify-center gap-6 bg-bg p-5">
      <Text className="text-xs text-sub">いま</Text>
      <Readout>0:00:00</Readout>
      <View className="w-full max-w-sm flex-row flex-wrap justify-center gap-2">
        {DEFAULT_ACTIVITIES.map((activity, index) => (
          <SwitchButton
            key={activity.name}
            name={activity.name}
            color={activity.color}
            active={index === active}
            onPress={() => setActive(index)}
          />
        ))}
      </View>
      <Pressable
        role="button"
        className="rounded-pill border border-line bg-chip px-4 py-2"
        onPress={() =>
          dispatch(
            preferencesSlice.actions.setTheme(
              theme === 'dark' ? 'light' : 'dark',
            ),
          )
        }
      >
        <Text className="text-xs text-sub">
          {theme === 'dark' ? 'ライト' : 'ダーク'}
        </Text>
      </Pressable>
    </View>
  )
}

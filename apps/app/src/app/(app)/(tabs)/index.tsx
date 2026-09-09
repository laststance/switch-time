import { DEFAULT_ACTIVITIES } from '@switch-time/shared'
import { useState } from 'react'
import { View } from 'react-native'

import { Readout } from '@/components/readout'
import { Screen } from '@/components/screen'
import { ScreenHeader } from '@/components/screen-header'
import { SwitchButton } from '@/components/switch-button'
import { formatDay } from '@/lib/format'
import { useAppSelector } from '@/store'

// Placeholder body until MVP-14 brings the clock and the real switch row: proves the tokens and both bands inside the shell.
export default function HomeScreen() {
  const [active, setActive] = useState(0)
  // ponytail: device-local calendar until the user's time zone setting is loaded (MVP-14).
  const day = useAppSelector((s) => formatDay(new Date(s.clock.now)))
  return (
    <Screen>
      <ScreenHeader title="いま" aside={day} />
      <View className="items-center gap-6 py-6">
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
      </View>
    </Screen>
  )
}

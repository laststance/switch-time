import { useState } from 'react'
import { FlatList, Keyboard, Pressable, Text, View } from 'react-native'

import { Control } from '@/components/control'
import { RetryNotice } from '@/components/retry-notice'
import { Sheet } from '@/components/sheet'
import { StrokeIcon } from '@/components/stroke-icon'
import { Input } from '@/components/ui/input'
import { useDeviceZone } from '@/hooks/use-device-zone'
import { useIosAnnouncement } from '@/hooks/use-ios-announcement'
import { useSettings, useUpdateSettings } from '@/hooks/use-settings'
import { useTokenColor } from '@/hooks/use-token-color'
import { CHECK } from '@/lib/icons'
import {
  type PickStatus,
  pickStatus,
  sameZone,
  zoneCatalog,
  zoneChoices,
  type ZoneEntry,
  zoneOptionText,
  zoneRowState,
  type ZoneRowState,
} from '@/lib/time-zones'
import { cn } from '@/lib/utils'

// Every row is h-14 (the hairline sits inside it), so the list can place any row without measuring.
const ROW_HEIGHT = 56

type ZoneOptionProps = ZoneRowState & {
  entry: ZoneEntry
  first: boolean
  /** A pick is being saved: not pressable, but not dimmed, since the status line says why. */
  busy: boolean
  onPick: (id: string) => void
}

// One row of the list (`ST Phone / タイムゾーンシート`): city, この端末 tag, country · offset, and the check on the account's zone.
function ZoneOption({
  entry,
  first,
  onDevice,
  checked,
  dimmed,
  busy,
  onPick,
}: ZoneOptionProps) {
  const { sub, label } = zoneOptionText(entry, onDevice)
  return (
    // A toggle button rather than a radio, as in Segmented: RN-web presses buttons on Space, and radios would owe arrow keys.
    <Pressable
      role="button"
      aria-label={label}
      aria-pressed={checked}
      disabled={dimmed || busy}
      onPress={() => onPick(entry.id)}
      className={cn(
        'focus-visible:outline-ink h-14 flex-row items-center gap-3 px-4 focus-visible:outline-2 focus-visible:-outline-offset-2',
        !first && 'border-line border-t',
        dimmed ? 'opacity-40' : 'active:opacity-70',
      )}
    >
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text
            numberOfLines={1}
            className="text-ink shrink text-sm font-semibold"
          >
            {entry.city}
          </Text>
          <DeviceTag shown={onDevice} />
        </View>
        <Text numberOfLines={1} className="text-sub text-2xs tabular">
          {sub}
        </Text>
      </View>
      <ZoneCheck shown={checked} />
    </Pressable>
  )
}

// The この端末 chip beside the city of this device's zone.
function DeviceTag({ shown }: { shown: boolean }) {
  if (!shown) return null
  return (
    <Text className="bg-chip text-sub rounded-pill px-2 py-0.5 text-2xs">
      この端末
    </Text>
  )
}

// The accent check on the account's zone; the row's aria-pressed already says it, so screen readers skip the icon.
function ZoneCheck({ shown }: { shown: boolean }) {
  const accent = useTokenColor('accent')
  if (!shown) return null
  return (
    <View aria-hidden className="text-accent">
      <StrokeIcon d={CHECK} size={16} strokeWidth={2} color={accent} />
    </View>
  )
}

// The line under the search after a pick (`ST Phone / タイムゾーンシート・状態`). Keyed by kind, so the failure mounts as a fresh
// alert and is announced rather than read as the old line's new text; iOS, without live regions, hears it from VoiceOver.
function PickStatusLine({ status }: { status: PickStatus }) {
  useIosAnnouncement(status?.text)
  if (!status) return null
  return status.alert ? (
    <Text
      key="alert"
      role="alert"
      className="text-ink -mt-2 text-2xs font-medium"
    >
      {status.text}
    </Text>
  ) : (
    <Text key="status" aria-live="polite" className="text-sub -mt-2 text-2xs">
      {status.text}
    </Text>
  )
}

// What the list shows when a search matches no zone: the query stays, and one tap brings the whole list back.
function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <View className="items-center gap-1 px-4 py-3">
      <Text className="text-sub text-xs">一致する都市がありません</Text>
      <Control disabled={false} onPress={onClear} className="h-11 px-3">
        <Text className="text-accent text-xs font-semibold">検索をクリア</Text>
      </Control>
    </View>
  )
}

// The search, the status line and the list, once the settings row could be read (or while it is still being read).
function ZonePicker() {
  const { settings, ready } = useSettings()
  const device = useDeviceZone()
  const update = useUpdateSettings()
  const [query, setQuery] = useState('')
  // Offsets are read once, when the sheet opens: each is an Intl lookup, and a search should not repeat ~400 of them.
  const [now] = useState(() => new Date())
  const [catalog] = useState(() => zoneCatalog(now))
  // The account's zone as the sheet opened stays pinned under this device's, so a pick never moves a row under the finger.
  const [pinned, setPinned] = useState<string>()
  if (ready && pinned === undefined) setPinned(settings.timeZone)
  const rows = zoneChoices(catalog, { query, device, pinned }, now)
  const zones = { device, stored: settings.timeZone, ready }
  const pick = (id: string): void => {
    // The account's own zone again is no change; writing it would only refetch every total.
    if (sameZone(id, settings.timeZone)) return
    Keyboard.dismiss()
    update.mutate({ timeZone: id })
  }
  return (
    <>
      <Input
        aria-label="都市・国名で検索"
        placeholder="都市・国名で検索"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      <PickStatusLine
        status={pickStatus(update.status, update.variables?.timeZone)}
      />
      <FlatList
        role="group"
        aria-label="タイムゾーン"
        data={rows}
        keyExtractor={(entry) => entry.id}
        getItemLayout={(_rows, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
        // A tap with the keyboard open picks the row instead of only closing the keyboard.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        className="border-line bg-surface shrink grow-0 overflow-hidden rounded-card border"
        renderItem={({ item, index }) => (
          <ZoneOption
            entry={item}
            first={index === 0}
            {...zoneRowState(item, zones)}
            busy={update.isPending}
            onPick={pick}
          />
        )}
        ListEmptyComponent={<NoMatch onClear={() => setQuery('')} />}
      />
    </>
  )
}

/**
 * The タイムゾーン sheet from `ST Phone / タイムゾーンシート`, opened from 設定's タイムゾーン row: search any zone by city, country or id
 * and pick one for the account. A pick writes at once and the sheet stays open, with a line under the search that says how the
 * write went; the other rows wait until it has.
 */
export default function TimeZoneSheet() {
  const { isError, retry } = useSettings()
  return (
    <Sheet
      title="タイムゾーン"
      hint="記録の日付の区切りに使います。過去の記録も含め、同じアカウントの端末すべてに効きます。端末のタイムゾーンが変わると、その端末に合わせて更新されます。"
    >
      {isError ? <RetryNotice onRetry={retry} /> : <ZonePicker />}
    </Sheet>
  )
}

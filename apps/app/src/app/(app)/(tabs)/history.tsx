import { Link } from 'expo-router'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { ActivityChip } from '@/components/activity-chip'
import { Control } from '@/components/control'
import { Screen } from '@/components/screen'
import { ScreenHeader } from '@/components/screen-header'
import { Segmented } from '@/components/segmented'
import { StrokeIcon } from '@/components/stroke-icon'
import { useAllActivities } from '@/hooks/use-activities'
import { useRangeStats } from '@/hooks/use-range-stats'
import { useTokenColor } from '@/hooks/use-token-color'
import {
  historyView,
  type BreakdownRow,
  type Cell,
  type HistoryView,
  type Range,
} from '@/lib/history'
import { INFO, PENCIL } from '@/lib/icons'
import { cn } from '@/lib/utils'

const UNIT: Record<Range, string> = { week: '週', month: '月' }
const RANGES: Range[] = ['week', 'month']

// The 週／月 picker from the pen; 今日 is the ホーム tab, so it is not repeated here.
const RANGE_OPTIONS = RANGES.map((value) => ({ value, label: UNIT[value] }))

function StepButton({
  label,
  glyph,
  disabled = false,
  onPress,
}: {
  label: string
  glyph: string
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Control
      label={label}
      disabled={disabled}
      onPress={onPress}
      className="h-9 w-9 rounded-chip"
    >
      <Text className="text-ink text-md">{glyph}</Text>
    </Control>
  )
}

// Every cell is a 24-h track in `chip` (like TodayFlow's bar); excluded days add the dashed `line` border on both platforms
// (ponytail: the native hatch is skipped, as in TodayFlow), and a day that was all detox the same dash in `sub`, the detox tone.
const CELL = {
  stack: 'bg-chip',
  detox: 'border border-dashed border-sub bg-chip',
  excluded: 'border border-dashed border-line bg-chip',
  empty: 'bg-chip',
}

function DayCell({ cell, height }: { cell: Cell; height: number }) {
  const column = (
    <>
      <View
        className={cn(
          'w-full flex-col-reverse overflow-hidden rounded-md',
          CELL[cell.kind],
        )}
        style={{ height }}
      >
        {cell.slices.map((slice) => (
          <View
            key={slice.activityId}
            className={cn(slice.top && 'rounded-t-md')}
            style={{ height: slice.height, backgroundColor: slice.color }}
          />
        ))}
      </View>
      <Text
        className={cn(
          'text-2xs font-medium',
          cell.today ? 'text-ink' : 'text-sub',
        )}
      >
        {cell.label}
      </Text>
    </>
  )
  // A disabled Link would still be an <a> on web, so inert days are plain Views rather than links.
  if (cell.kind === 'empty')
    return <View className="flex-1 items-center gap-1.5">{column}</View>
  return (
    <Link href={{ pathname: '/correction', params: { day: cell.day } }} asChild>
      <Pressable
        aria-label={cell.ariaLabel}
        className="flex-1 items-center gap-1.5"
      >
        {column}
      </Pressable>
    </Link>
  )
}

function Chart({
  view,
  unit,
  latest,
  onStep,
}: {
  view: HistoryView
  unit: string
  latest: boolean
  onStep: (delta: number) => void
}) {
  return (
    <View className="border-line bg-surface gap-3.5 rounded-card border px-4 pt-4.5 pb-3.5">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1">
          <StepButton
            label={`前の${unit}`}
            glyph="‹"
            onPress={() => onStep(-1)}
          />
          <Text className="text-ink text-sm font-semibold">{view.title}</Text>
          <StepButton
            label={`次の${unit}`}
            glyph="›"
            disabled={latest}
            onPress={() => onStep(1)}
          />
        </View>
        <Text className="text-sub text-2xs">1本 = 24時間</Text>
      </View>
      {view.weekdays.length > 0 && (
        <View className="flex-row gap-1.5">
          {view.weekdays.map((weekday) => (
            <Text
              key={weekday}
              className="text-sub flex-1 text-center text-2xs"
            >
              {weekday}
            </Text>
          ))}
        </View>
      )}
      {view.rows.map((row, rowIndex) => (
        <View key={rowIndex} className="flex-row gap-1.5">
          {row.map((cell, slot) =>
            cell ? (
              <DayCell key={cell.day} cell={cell} height={view.barHeight} />
            ) : (
              <View key={`pad-${slot}`} className="flex-1" />
            ),
          )}
        </View>
      ))}
    </View>
  )
}

function Cards({ view }: { view: HistoryView }) {
  const cards: [string, string][] = [
    ['計測できた日', view.measured],
    ['連続記録', view.streak],
  ]
  return (
    <View className="flex-row gap-2.5">
      {cards.map(([label, value]) => (
        <View
          key={label}
          className="border-line bg-surface flex-1 gap-1 rounded-card border px-4 py-3.5"
        >
          <Text className="text-sub text-2xs">{label}</Text>
          <Text className="text-ink text-xl font-semibold tabular">
            {value}
          </Text>
        </View>
      ))}
    </View>
  )
}

function Footnote({ count }: { count: number }) {
  const sub = useTokenColor('sub')
  // Nothing to explain until a day has been skipped.
  if (count === 0) return null
  return (
    <Link href="/excluded-days" asChild>
      <Pressable className="bg-chip text-sub flex-row items-center gap-2.5 rounded-card px-4 py-3.25">
        <StrokeIcon d={INFO} size={18} strokeWidth={1.8} color={sub} />
        <Text className="text-sub flex-1 text-xs">
          アプリを使わなかった {count}日 は平均から除外しています（点線の日）
        </Text>
        <Text className="text-sub text-sm">›</Text>
      </Pressable>
    </Link>
  )
}

function Breakdown({ rows }: { rows: BreakdownRow[] }) {
  return (
    <View className="border-line bg-surface gap-3.5 rounded-card border p-4">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-ink text-sm font-semibold">状態別</Text>
        <Text className="text-sub text-2xs">合計 ／ 1日あたり</Text>
      </View>
      {rows.map((row) => (
        <View key={row.id} className="gap-1.5">
          <View className="flex-row items-center gap-2">
            <ActivityChip
              color={row.color}
              iconKey={row.iconKey}
              size={26}
              iconSize={15}
            />
            <Text className="text-ink flex-1 text-sm font-semibold">
              {row.name}
            </Text>
            <Text className="text-ink text-sm font-semibold tabular">
              {row.total}
            </Text>
            <Text className="text-sub pl-3 text-xs tabular">{row.average}</Text>
          </View>
          <View className="bg-chip h-2 overflow-hidden rounded-sm">
            <View
              className="h-full rounded-sm"
              style={{
                width: `${row.ratio * 100}%`,
                backgroundColor: row.color,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  )
}

function CorrectionButton() {
  const ink = useTokenColor('ink')
  return (
    <Link href="/correction" asChild>
      <Pressable className="border-line text-ink h-13 flex-row items-center justify-center gap-2 rounded-chip border">
        <StrokeIcon d={PENCIL} size={16} strokeWidth={2} color={ink} />
        <Text className="text-ink text-sm font-semibold">記録を訂正する</Text>
      </Pressable>
    </Link>
  )
}

// Everything under the range picker: the one `stats.*` answer for the visible range, turned into the render model.
function HistoryBody({
  range,
  offset,
  onStep,
}: {
  range: Range
  offset: number
  onStep: (delta: number) => void
}) {
  const { today, stats } = useRangeStats(range, offset)
  const activities = useAllActivities()
  if (!stats || !activities.data) return null
  const view = historyView({
    range,
    offset,
    today,
    stats,
    activities: activities.data,
  })
  return (
    <>
      <Chart
        view={view}
        unit={UNIT[range]}
        latest={offset === 0}
        onStep={onStep}
      />
      <Cards view={view} />
      <Footnote count={view.unusedDays} />
      <Breakdown rows={view.breakdown} />
      <CorrectionButton />
    </>
  )
}

export default function HistoryScreen() {
  const [range, setRange] = useState<Range>('week')
  const [offset, setOffset] = useState(0)
  // A new range starts at its latest window.
  const pickRange = (next: Range): void => {
    setRange(next)
    setOffset(0)
  }
  return (
    <Screen>
      <ScreenHeader title="記録" />
      <Segmented
        size="md"
        grow
        label="期間"
        options={RANGE_OPTIONS}
        value={range}
        onChange={pickRange}
      />
      <HistoryBody
        range={range}
        offset={offset}
        onStep={(delta) => setOffset((current) => current + delta)}
      />
    </Screen>
  )
}

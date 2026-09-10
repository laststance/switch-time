import { useQuery } from '@tanstack/react-query'
import { Link } from 'expo-router'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { ActivityChip } from '@/components/activity-chip'
import { Screen } from '@/components/screen'
import { ScreenHeader } from '@/components/screen-header'
import { StrokeIcon } from '@/components/stroke-icon'
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
import { orpc } from '@/lib/orpc'
import { cn } from '@/lib/utils'

const UNIT: Record<Range, string> = { week: '週', month: '月' }
const RANGES: Range[] = ['week', 'month']

// The 週／月 segmented control from the pen; 今日 is the ホーム tab, so it is not repeated here.
function RangePicker({
  range,
  onChange,
}: {
  range: Range
  onChange: (next: Range) => void
}) {
  return (
    <View
      role="group"
      aria-label="期間"
      className="flex-row gap-1 rounded-chip bg-chip p-1"
    >
      {RANGES.map((key) => {
        const checked = key === range
        // Toggle buttons rather than radios: RN-web only fires Space (and Enter) for the button role, and there is no arrow-key handling.
        return (
          <Pressable
            key={key}
            role="button"
            aria-pressed={checked}
            onPress={() => onChange(key)}
            className={cn(
              'h-9 flex-1 items-center justify-center rounded-[8px]',
              checked && 'bg-surface',
            )}
          >
            <Text
              className={cn(
                'text-sm',
                checked ? 'font-semibold text-ink' : 'text-sub',
              )}
            >
              {UNIT[key]}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

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
    <Pressable
      role="button"
      aria-label={label}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'h-9 w-9 items-center justify-center rounded-chip',
        disabled && 'opacity-30',
      )}
    >
      <Text className="text-md text-ink">{glyph}</Text>
    </Pressable>
  )
}

// Every cell is a 24-h track in `chip` (like TodayFlow's bar); excluded days add the dashed `line` border on both platforms
// (ponytail: the native hatch is skipped, as in TodayFlow).
const CELL = {
  stack: 'bg-chip',
  excluded: 'border border-dashed border-line bg-chip',
  empty: 'bg-chip',
}

function DayCell({ cell, height }: { cell: Cell; height: number }) {
  const column = (
    <>
      <View
        className={cn(
          'w-full flex-col-reverse overflow-hidden rounded-[6px]',
          CELL[cell.kind],
        )}
        style={{ height }}
      >
        {cell.slices.map((slice) => (
          <View
            key={slice.activityId}
            className={cn(slice.top && 'rounded-t-[6px]')}
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
    <View className="gap-3.5 rounded-card border border-line bg-surface px-4 pb-3.5 pt-[18px]">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1">
          <StepButton
            label={`前の${unit}`}
            glyph="‹"
            onPress={() => onStep(-1)}
          />
          <Text className="text-sm font-semibold text-ink">{view.title}</Text>
          <StepButton
            label={`次の${unit}`}
            glyph="›"
            disabled={latest}
            onPress={() => onStep(1)}
          />
        </View>
        <Text className="text-2xs text-sub">1本 = 24時間</Text>
      </View>
      {view.weekdays.length > 0 && (
        <View className="flex-row gap-1.5">
          {view.weekdays.map((weekday) => (
            <Text
              key={weekday}
              className="flex-1 text-center text-2xs text-sub"
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
          className="flex-1 gap-1 rounded-card border border-line bg-surface px-4 py-3.5"
        >
          <Text className="text-2xs text-sub">{label}</Text>
          <Text className="text-xl font-semibold text-ink tabular">
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
      <Pressable className="flex-row items-center gap-2.5 rounded-card bg-chip px-4 py-[13px] text-sub">
        <StrokeIcon d={INFO} size={18} strokeWidth={1.8} color={sub} />
        <Text className="flex-1 text-xs text-sub">
          アプリを使わなかった {count}日 は平均から除外しています（点線の日）
        </Text>
        <Text className="text-sm text-sub">›</Text>
      </Pressable>
    </Link>
  )
}

function Breakdown({ rows }: { rows: BreakdownRow[] }) {
  return (
    <View className="gap-3.5 rounded-card border border-line bg-surface p-4">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-sm font-semibold text-ink">状態別</Text>
        <Text className="text-2xs text-sub">合計 ／ 1日あたり</Text>
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
            <Text className="flex-1 text-sm font-semibold text-ink">
              {row.name}
            </Text>
            <Text className="text-sm font-semibold text-ink tabular">
              {row.total}
            </Text>
            <Text className="pl-3 text-xs text-sub tabular">{row.average}</Text>
          </View>
          <View className="h-2 overflow-hidden rounded-[4px] bg-chip">
            <View
              className="h-full rounded-[4px]"
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
      <Pressable className="h-[52px] flex-row items-center justify-center gap-2 rounded-chip border border-line text-ink">
        <StrokeIcon d={PENCIL} size={16} strokeWidth={2} color={ink} />
        <Text className="text-sm font-semibold text-ink">記録を訂正する</Text>
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
  const activities = useQuery(orpc.activities.list.queryOptions())
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
  const pickRange = (next: Range) => {
    setRange(next)
    setOffset(0)
  }
  return (
    <Screen>
      <ScreenHeader title="記録" />
      <RangePicker range={range} onChange={pickRange} />
      <HistoryBody
        range={range}
        offset={offset}
        onStep={(delta) => setOffset((current) => current + delta)}
      />
    </Screen>
  )
}

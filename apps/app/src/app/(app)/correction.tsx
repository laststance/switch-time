import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { ActivityChip } from '@/components/activity-chip'
import { ActivityPill } from '@/components/activity-pill'
import { dismissSheet, Sheet } from '@/components/sheet'
import { useActivities } from '@/hooks/use-activities'
import { useCorrection } from '@/hooks/use-correction'
import type { CorrectionRow, DayBounds } from '@/lib/correction'
import { cn } from '@/lib/utils'

const DIMMED = 0.4

type BarProps = {
  rows: CorrectionRow[]
  bounds: DayBounds
  selectedId: string | null
}

// The 12 px 24-h strip above the list: the selected row's span stays solid, the rest dim to 0.4.
function DayBar({ rows, bounds, selectedId }: BarProps) {
  const percent = (ms: number): `${number}%` =>
    `${(ms / (bounds.end - bounds.start)) * 100}%`
  // A merged or undone row's id lingers in the selection; with no row to highlight, nothing dims.
  const active = rows.some((row) => row.id === selectedId) ? selectedId : null
  return (
    <View className="h-3 w-full overflow-hidden rounded-[6px] bg-chip">
      {rows.map((row) => (
        <View
          key={row.id}
          className="absolute inset-y-0"
          style={{
            left: percent(row.start - bounds.start),
            width: percent(row.end - row.start),
            backgroundColor: row.color,
            opacity: active === null || active === row.id ? 1 : DIMMED,
          }}
        />
      ))}
    </View>
  )
}

type RowHeaderProps = {
  row: CorrectionRow
  selected: boolean
  onPress: () => void
}

// The tappable part of a row: chip, name, span and length. The carried-in state is plain text (nothing to correct).
function RowHeader({ row, selected, onPress }: RowHeaderProps) {
  return (
    <Pressable
      role="button"
      aria-expanded={selected}
      disabled={!row.editable}
      onPress={onPress}
      className="h-[58px] flex-row items-center gap-3 px-3.5"
    >
      <ActivityChip
        color={row.color}
        iconKey={row.iconKey}
        size={32}
        iconSize={18}
      />
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-semibold text-ink">{row.name}</Text>
        <Text className="text-xs text-sub tabular">{row.range}</Text>
      </View>
      <Text className="text-sm font-semibold text-sub tabular">
        {row.duration}
      </Text>
    </Pressable>
  )
}

type StepProps = {
  glyph: '−' | '＋'
  label: string
  disabled: boolean
  onPress: () => void
}

function StepButton({ glyph, label, disabled, onPress }: StepProps) {
  return (
    <Pressable
      role="button"
      aria-label={label}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'h-11 w-11 items-center justify-center rounded-chip border border-line bg-sheet-bg',
        disabled && 'opacity-30',
      )}
    >
      <Text className="text-md text-ink">{glyph}</Text>
    </Pressable>
  )
}

type ActionButtonProps = {
  title: string
  disabled: boolean
  onPress: () => void
}

function ActionButton({ title, disabled, onPress }: ActionButtonProps) {
  return (
    <Pressable
      role="button"
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'h-11 flex-1 items-center justify-center rounded-chip border border-line',
        disabled && 'opacity-30',
      )}
    >
      <Text className="text-xs font-semibold text-ink">{title}</Text>
    </Pressable>
  )
}

type ActionsProps = {
  row: CorrectionRow
  pending: boolean
  onMove: (deltaMinutes: 15 | -15) => void
  onPick: (activityId: string) => void
  onMerge: () => void
  onSplit: () => void
}

// The panel under the selected row: ±15 min on the start, the activity picker, merge and split.
function Actions({
  row,
  pending,
  onMove,
  onPick,
  onMerge,
  onSplit,
}: ActionsProps) {
  const live = useActivities().data ?? []
  // One gate for every control: nothing is pressable while a fetch or an edit is in flight.
  const can = (flag: boolean) => !pending && flag
  return (
    <View className="gap-3 px-3.5 pb-3.5 pt-0.5">
      <View className="flex-row items-center gap-2.5">
        <Text className="flex-1 text-xs font-medium text-sub">開始時刻</Text>
        <StepButton
          glyph="−"
          label="15分早める"
          disabled={!can(row.canMoveEarlier)}
          onPress={() => onMove(-15)}
        />
        <Text className="px-3 text-md font-semibold text-ink tabular">
          {row.startLabel}
        </Text>
        <StepButton
          glyph="＋"
          label="15分遅らせる"
          disabled={!can(row.canMoveLater)}
          onPress={() => onMove(15)}
        />
      </View>
      <View className="gap-[7px]">
        <Text className="text-xs font-medium text-sub">活動を変える</Text>
        <View
          role="radiogroup"
          aria-label="活動を変える"
          className="flex-row flex-wrap gap-[7px]"
        >
          {live.map((activity) => (
            <ActivityPill
              key={activity.id}
              name={activity.name}
              color={activity.color}
              iconKey={activity.iconKey}
              selected={activity.id === row.activityId}
              disabled={pending}
              // Re-picking the current activity would be a pointless write (source → correction) that also arms undo.
              onPress={() => {
                if (activity.id !== row.activityId) onPick(activity.id)
              }}
            />
          ))}
        </View>
      </View>
      <View className="flex-row gap-2">
        <ActionButton
          title="前の記録に統合"
          disabled={!can(row.canMerge)}
          onPress={onMerge}
        />
        <ActionButton
          title="半分で分割"
          disabled={!can(row.canSplit)}
          onPress={onSplit}
        />
      </View>
    </View>
  )
}

type FooterProps = { canUndo: boolean; onUndo: () => void }

function Footer({ canUndo, onUndo }: FooterProps) {
  return (
    <View className="flex-row gap-2">
      <Pressable
        role="button"
        disabled={!canUndo}
        onPress={onUndo}
        className={cn(
          'h-[52px] flex-1 items-center justify-center rounded-chip border border-line',
          !canUndo && 'opacity-30',
        )}
      >
        <Text className="text-sm font-semibold text-ink">元に戻す</Text>
      </Pressable>
      <Pressable
        role="button"
        onPress={dismissSheet}
        className="h-[52px] flex-[2] items-center justify-center rounded-chip bg-ink"
      >
        <Text className="text-sm font-semibold text-sheet-bg">完了</Text>
      </Pressable>
    </View>
  )
}

/** Sheet for one day's switches: rows newest first, the selected one opens its action panel; `?day=` picks the day. */
export default function CorrectionSheet() {
  const params = useLocalSearchParams<{ day?: string }>()
  const correction = useCorrection(params.day)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  return (
    <Sheet
      title={correction.title}
      hint="行をタップ → 開始時刻を15分ずつ動かす／活動を変える"
    >
      <DayBar
        rows={correction.rows}
        bounds={correction.bounds}
        selectedId={selectedId}
      />
      <ScrollView className="shrink" contentContainerClassName="gap-2">
        {correction.rows.map((row) => {
          const selected = row.id === selectedId
          return (
            <View
              key={row.id}
              className={cn(
                'rounded-card border border-line',
                selected && 'bg-chip',
              )}
              style={selected ? { borderColor: row.color } : null}
            >
              <RowHeader
                row={row}
                selected={selected}
                onPress={() => setSelectedId(selected ? null : row.id)}
              />
              {selected && (
                <Actions
                  row={row}
                  pending={correction.pending}
                  onMove={(deltaMinutes) =>
                    correction.move(row.id, deltaMinutes)
                  }
                  onPick={(activityId) => correction.pick(row.id, activityId)}
                  onMerge={() => correction.merge(row.id)}
                  onSplit={() => correction.split(row.id)}
                />
              )}
            </View>
          )
        })}
      </ScrollView>
      <Footer
        canUndo={correction.canUndo && !correction.pending}
        onUndo={correction.undo}
      />
    </Sheet>
  )
}

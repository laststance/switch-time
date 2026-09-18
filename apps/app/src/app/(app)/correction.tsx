import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { ActivityChip } from '@/components/activity-chip'
import { ActivityPill } from '@/components/activity-pill'
import { Control } from '@/components/control'
import { dismissSheet, Sheet } from '@/components/sheet'
import { useActivities } from '@/hooks/use-activities'
import { useCorrection } from '@/hooks/use-correction'
import type { CorrectionRow, DayBounds } from '@/lib/correction'
import { DETOX } from '@/lib/detox'
import { cn } from '@/lib/utils'

const DIMMED = 0.4

// The selected card takes its row's colour on the border; detox has none and keeps the `line` hairline.
const frame = (selected: boolean, color: string | null) =>
  selected && color !== null ? { borderColor: color } : null

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
  const dim = (id: string) => (active === null || active === id ? 1 : DIMMED)
  return (
    <View className="bg-chip h-3 w-full overflow-hidden rounded-md">
      {rows.map((row) => (
        <View
          key={row.id}
          // A detox span has no colour: outlined, like the 24-h bar's idle spans.
          className={cn(
            'absolute inset-y-0',
            row.color === null && 'border-line border border-dashed',
          )}
          style={{
            left: percent(row.start - bounds.start),
            width: percent(row.end - row.start),
            backgroundColor: row.color ?? undefined,
            opacity: dim(row.id),
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
      className="h-14.5 flex-row items-center gap-3 px-3.5"
    >
      <ActivityChip
        color={row.color}
        iconKey={row.iconKey}
        size={32}
        iconSize={18}
      />
      <View className="flex-1 gap-0.5">
        <Text className="text-ink text-sm font-semibold">{row.name}</Text>
        <Text className="text-sub text-xs tabular">{row.range}</Text>
      </View>
      <Text className="text-sub text-sm font-semibold tabular">
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
    <Control
      label={label}
      disabled={disabled}
      onPress={onPress}
      className="border-line bg-sheet-bg h-11 w-11 rounded-chip border"
    >
      <Text className="text-ink text-md">{glyph}</Text>
    </Control>
  )
}

type ActionButtonProps = {
  title: string
  disabled: boolean
  onPress: () => void
  className?: string
}

// Full width in a column; pass `flex-1` only inside a row (in a column it collapses the button to its text height).
function ActionButton({
  title,
  disabled,
  onPress,
  className,
}: ActionButtonProps) {
  return (
    <Control
      disabled={disabled}
      onPress={onPress}
      className={cn('border-line h-11 rounded-chip border', className)}
    >
      <Text className="text-ink text-xs font-semibold">{title}</Text>
    </Control>
  )
}

type ActionsProps = {
  row: CorrectionRow
  pending: boolean
  onMove: (deltaMinutes: 15 | -15) => void
  onPick: (activityId: string | null) => void
  onMergePrevious: () => void
  onMergeNext: () => void
  onSplit: () => void
}

// The panel under the selected row: ±15 min on the start, the activity picker, merge either way and split.
function Actions({
  row,
  pending,
  onMove,
  onPick,
  onMergePrevious,
  onMergeNext,
  onSplit,
}: ActionsProps) {
  const live = useActivities().data ?? []
  // One gate for every control: nothing is pressable while a fetch or an edit is in flight.
  const can = (flag: boolean) => !pending && flag
  return (
    <View className="gap-3 px-3.5 pt-0.5 pb-3.5">
      <View className="flex-row items-center gap-2.5">
        <Text className="text-sub flex-1 text-xs font-medium">開始時刻</Text>
        <StepButton
          glyph="−"
          label="15分早める"
          disabled={!can(row.canMoveEarlier)}
          onPress={() => onMove(-15)}
        />
        <Text className="text-ink px-3 text-md font-semibold tabular">
          {row.startLabel}
        </Text>
        <StepButton
          glyph="＋"
          label="15分遅らせる"
          disabled={!can(row.canMoveLater)}
          onPress={() => onMove(15)}
        />
      </View>
      <View className="gap-1.75">
        <Text className="text-sub text-xs font-medium">活動を変える</Text>
        <View
          role="radiogroup"
          aria-label="活動を変える"
          className="flex-row flex-wrap gap-1.75"
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
          <ActivityPill
            name={DETOX.name}
            color={DETOX.color}
            iconKey={DETOX.iconKey}
            selected={row.activityId === null}
            disabled={pending}
            // Same guard as the activity pills: re-picking detox on a detox row would be a pointless write.
            onPress={() => {
              if (row.activityId !== null) onPick(null)
            }}
          />
        </View>
      </View>
      <View className="gap-2">
        <View className="flex-row gap-2">
          <ActionButton
            title="前の記録に統合"
            disabled={!can(row.canMergePrevious)}
            onPress={onMergePrevious}
            className="flex-1"
          />
          <ActionButton
            title="次の記録に統合"
            disabled={!can(row.canMergeNext)}
            onPress={onMergeNext}
            className="flex-1"
          />
        </View>
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
      <Control
        disabled={!canUndo}
        onPress={onUndo}
        className="border-line h-13 flex-1 rounded-chip border"
      >
        <Text className="text-ink text-sm font-semibold">元に戻す</Text>
      </Control>
      <Pressable
        role="button"
        onPress={dismissSheet}
        className="bg-ink h-13 flex-2 items-center justify-center rounded-chip"
      >
        <Text className="text-sheet-bg text-sm font-semibold">完了</Text>
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
                'border-line rounded-card border',
                selected && 'bg-chip',
              )}
              style={frame(selected, row.color)}
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
                  onMergePrevious={() => correction.mergePrevious(row.id)}
                  onMergeNext={() => correction.mergeNext(row.id)}
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

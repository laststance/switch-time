import { useLocalSearchParams } from 'expo-router'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'

import { ActivityChip } from '@/components/activity-chip'
import { ActivityPill } from '@/components/activity-pill'
import { Control } from '@/components/control'
import { dismissSheet, Sheet } from '@/components/sheet'
import { useActivities } from '@/hooks/use-activities'
import { useCorrection } from '@/hooks/use-correction'
import {
  archivedBox,
  CUT_STEPS,
  cutStepper,
  cutNotes,
  revealOffset,
  type ChosenCut,
  type CorrectionRow,
  type CutStepMinutes,
  type DayBounds,
  type TotalsFacts,
} from '@/lib/correction'
import { DETOX } from '@/lib/detox'
import { cn } from '@/lib/utils'

const DIMMED = 0.4
// gstack-shortcut(dec-f15d7e22): notes stay text-sub below AA, upgrade when the sub token contrast TODO lands
const NOTE = 'text-sub text-xs leading-4.5'
// The four 区切る時刻 steps: the glyph text on the button, and the action a screen reader speaks instead.
const STEP_TEXT: Record<CutStepMinutes, { title: string; label: string }> = {
  [-60]: { title: '−1時間', label: '区切る時刻を1時間早める' },
  [-15]: { title: '−15分', label: '区切る時刻を15分早める' },
  [15]: { title: '+15分', label: '区切る時刻を15分遅らせる' },
  [60]: { title: '+1時間', label: '区切る時刻を1時間遅らせる' },
}
const ARCHIVED_TEXT = {
  warning:
    'この記録の活動はアーカイブ済みです。別の活動に変えると元に戻せません',
  notice: '前の活動はアーカイブ済みのため、元に戻せません',
}

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

// Keyboard focus on web, screen-reader focus on native.
function takeFocus(node: View): void {
  if (Platform.OS === 'web') return node.focus()
  const tag = findNodeHandle(node)
  if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag)
}

type RowHeaderProps = {
  row: CorrectionRow
  selected: boolean
  focused: boolean
  onPress: () => void
}

// The tappable part of a row: chip, name, span and length. `focused` takes keyboard and screen-reader focus, for the row a
// cut just created (the pressed 「ここで分割」 left the screen with its panel).
function RowHeader({ row, selected, focused, onPress }: RowHeaderProps) {
  // A new callback when `focused` turns on, so React attaches it again and the header takes focus once.
  const header = useCallback(
    (node: View | null) => {
      if (focused && node) takeFocus(node)
    },
    [focused],
  )
  return (
    <Pressable
      ref={header}
      role="button"
      aria-expanded={selected}
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
  label?: string
  disabled: boolean
  onPress: () => void
  className?: string
}

// Full width in a column; pass `flex-1` only inside a row (in a column it collapses the button to its text height).
function ActionButton({
  title,
  label,
  disabled,
  onPress,
  className,
}: ActionButtonProps) {
  return (
    <Control
      label={label}
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
  /** The activity picker, built by the caller. */
  picker: ReactNode
  onMergePrevious: () => void
  onMergeNext: () => void
  onSplit: () => void
}

// The panel under the selected row: ±15 min on the start, the activity picker, merge either way and split.
function Actions({
  row,
  pending,
  onMove,
  picker,
  onMergePrevious,
  onMergeNext,
  onSplit,
}: ActionsProps) {
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
        {picker}
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

type PickerProps = {
  row: CorrectionRow
  pending: boolean
  onPick: (activityId: string | null) => void
}

// The live activities and detox as pills; the row's own activity is the selected one.
function ActivityPicker({ row, pending, onPick }: PickerProps) {
  const live = useActivities().data ?? []
  return (
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
  )
}

type CarriedInActionsProps = {
  row: CorrectionRow
  pending: boolean
  timeZone: string
  totalsFacts: TotalsFacts
  noticeId: string | null
  /** The activity picker, built by the caller. */
  picker: ReactNode
  onCut: (at: number) => void
}

// The panel under the carried-in record (layout B2): where it really started, 区切る時刻 with 「ここで分割」, and the picker,
// which changes the whole record. It never moves or merges the record: that would rewrite the earlier day.
function CarriedInActions({
  row,
  pending,
  timeZone,
  totalsFacts,
  noticeId,
  picker,
  onCut,
}: CarriedInActionsProps) {
  const [chosen, setChosen] = useState<ChosenCut | null>(null)
  const stepper = cutStepper(row, chosen, timeZone)
  const step = (target: number): void => {
    setChosen({ id: row.id, at: target })
    // Android and web read the readout's live region; iOS needs the announcement.
    if (Platform.OS === 'ios')
      AccessibilityInfo.announceForAccessibility(
        cutStepper(row, { id: row.id, at: target }, timeZone).label,
      )
  }
  return (
    <View className="gap-3 px-3.5 pt-0.5 pb-3.5">
      <Text className={NOTE}>{`${row.trueStartLabel} から続く記録です`}</Text>
      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-sub text-xs font-medium">区切る時刻</Text>
          <Text
            role="status"
            aria-label="区切る時刻"
            aria-live="polite"
            className="text-ink text-lg font-semibold tabular"
          >
            {stepper.label}
          </Text>
        </View>
        <View className="flex-row gap-2">
          {CUT_STEPS.map((minutes) => {
            const target = stepper.targets[minutes]
            return (
              <ActionButton
                key={minutes}
                title={STEP_TEXT[minutes].title}
                label={STEP_TEXT[minutes].label}
                disabled={pending || target === null}
                onPress={() => {
                  if (target !== null) step(target)
                }}
                className="flex-1"
              />
            )
          })}
        </View>
        <Control
          disabled={pending || stepper.at === null}
          onPress={() => {
            if (stepper.at !== null) onCut(stepper.at)
          }}
          className="bg-ink h-11 rounded-chip"
        >
          <Text className="text-sheet-bg text-xs font-semibold">
            ここで分割
          </Text>
        </Control>
        {cutNotes(row, totalsFacts, stepper.at).map((note) => (
          <Text key={note} className={NOTE}>
            {note}
          </Text>
        ))}
      </View>
      <View className="gap-1.75">
        <View className="gap-1">
          <Text className="text-sub text-xs font-medium">活動を変える</Text>
          <Text className={NOTE}>
            {`記録全体（${row.trueStartLabel}〜）が変わり、${row.trueStartDate}の集計にも反映されます`}
          </Text>
        </View>
        <ArchivedBox kind={archivedBox(row, noticeId)} />
        {picker}
      </View>
    </View>
  )
}

// The bordered box above the pills (on the selected card's chip fill): the archived warning before a pick, the notice after it.
function ArchivedBox({ kind }: { kind: 'warning' | 'notice' | null }) {
  if (!kind) return null
  return (
    <View className="bg-sheet-bg border-line rounded-chip border px-3 py-2">
      {/* Only the notice after a pick or a refused undo is announced; the warning before a pick is plain text. The key
          mounts a fresh node when the warning turns into the notice, so the alert is announced rather than updated in place. */}
      <Text
        key={kind}
        role={kind === 'notice' ? 'alert' : undefined}
        className="text-ink text-xs leading-4.5"
      >
        {ARCHIVED_TEXT[kind]}
      </Text>
    </View>
  )
}

type RowPanelProps = {
  row: CorrectionRow
  correction: ReturnType<typeof useCorrection>
}

// The selected row's panel: the carried-in record cuts or changes its activity, the day's own rows get every edit.
function RowPanel({ row, correction }: RowPanelProps) {
  const picker = (
    <ActivityPicker
      row={row}
      pending={correction.pending}
      onPick={(activityId) => correction.pick(row, activityId)}
    />
  )
  if (row.carriedIn)
    return (
      <CarriedInActions
        row={row}
        pending={correction.pending}
        timeZone={correction.bounds.timeZone}
        totalsFacts={correction.totalsFacts}
        noticeId={correction.noticeId}
        picker={picker}
        onCut={(at) => correction.cut(row, at)}
      />
    )
  return (
    <Actions
      row={row}
      pending={correction.pending}
      onMove={(deltaMinutes) => correction.move(row, deltaMinutes)}
      picker={picker}
      onMergePrevious={() => correction.mergePrevious(row)}
      onMergeNext={() => correction.mergeNext(row)}
      onSplit={() => correction.split(row)}
    />
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
  const scroll = useRef<ScrollView>(null)
  const viewport = useRef({ scrollY: 0, viewportHeight: 0 })
  // The row last revealed: a card lays out again on every tick and edit, and only a new selection should scroll.
  const revealed = useRef<string | null>(null)
  // Scrolls just enough to show the whole selected card once it has laid out with its panel; reduced motion jumps.
  const reveal = (card: { top: number; height: number }): void => {
    const y = revealOffset(card, viewport.current)
    if (y === null) return
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) =>
      scroll.current?.scrollTo({ y, animated: !reduced }),
    )
  }
  return (
    <Sheet
      title={correction.title}
      hint="行をタップ → 開始時刻を15分ずつ動かす／活動を変える"
    >
      <DayBar
        rows={correction.rows}
        bounds={correction.bounds}
        selectedId={correction.selectedId}
      />
      <ScrollView
        ref={scroll}
        className="shrink"
        contentContainerClassName="gap-2"
        scrollEventThrottle={16}
        onScroll={(event) => {
          viewport.current.scrollY = event.nativeEvent.contentOffset.y
        }}
        onLayout={(event) => {
          viewport.current.viewportHeight = event.nativeEvent.layout.height
        }}
      >
        {correction.rows.map((row) => {
          const selected = row.id === correction.selectedId
          return (
            <View
              key={row.id}
              className={cn(
                'border-line rounded-card border',
                selected && 'bg-chip',
              )}
              style={frame(selected, row.color)}
              onLayout={(event) => {
                const { y, height } = event.nativeEvent.layout
                if (selected && revealed.current !== row.id) {
                  revealed.current = row.id
                  reveal({ top: y, height })
                }
              }}
            >
              <RowHeader
                row={row}
                selected={selected}
                focused={row.id === correction.focusId}
                onPress={() => {
                  // A tap always reveals, even on the row that was selected before.
                  revealed.current = null
                  correction.select(selected ? null : row.id)
                }}
              />
              {selected && <RowPanel row={row} correction={correction} />}
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

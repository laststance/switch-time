import { dayBounds, daySchema, type SplitAtInput } from '@switch-time/shared'
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useState } from 'react'

import { useAllActivities } from '@/hooks/use-activities'
import { useExcludedDays } from '@/hooks/use-excluded-days'
import { useLocalToday } from '@/hooks/use-local-today'
import { useSettings } from '@/hooks/use-settings'
import {
  afterUndoFailure,
  correctionRows,
  dayTitle,
  pickRequest,
  undoRequest,
  undoSlotFor,
  type CorrectionEdit,
  type CorrectionRow,
  type ListedDay,
  type TotalsFacts,
  type UndoSlot,
} from '@/lib/correction'
import { orpc } from '@/lib/orpc'
import { invalidateKeys } from '@/lib/query'
import { useAppSelector } from '@/store'

/**
 * Everything the correction sheet needs for one day: the row model, the selection, the `switches.*` edits and 「元に戻す」.
 * Every edit invalidates `switches.*` and `stats.*`, so Home and History pick it up at once. An invalid or missing `dayParam`
 * means today.
 *
 * The undo slot ({@link UndoSlot}) is one of two kinds. A `day` slot holds the day's rows before the last edit and writes them
 * back through `switches.replaceDay`; every edit arms it, except a pick on the carried-in record, which arms an `activity`
 * slot that puts the previous activity back through `switches.changeActivity` only while the record still holds the pick
 * (that record reaches another day, which the day slot cannot rewrite). A pick away from an archived activity arms nothing
 * and drops any older slot, and raises the archived notice instead ({@link undoSlotFor}). A failed activity undo is sorted by
 * {@link afterUndoFailure}; a failed day undo keeps its slot.
 * @example const correction = useCorrection(params.day)
 */
export function useCorrection(dayParam: string | undefined) {
  const { today, timeZone, ready } = useLocalToday()
  const day = daySchema.safeParse(dayParam).data ?? today
  const now = useAppSelector((s) => s.clock.now)
  const list = useQuery(
    orpc.switches.listByDay.queryOptions({ input: { day }, enabled: ready }),
  )
  const activities = useAllActivities()
  const state = useCorrectionState()
  const edits = useCorrectionEdits(day, list.data, state)
  const undo = useCorrectionUndo(state)
  // Any switches write holds the panel, not only this sheet's: a hotkey tap, or an edit still landing from a sheet closed mid-flight.
  const writing = useIsMutating({ mutationKey: orpc.switches.key() }) > 0
  const bounds = { ...dayBounds(day, timeZone), now, timeZone }
  return {
    day,
    title: dayTitle(day, today),
    bounds,
    rows: correctionRows(list.data, activities.data, bounds),
    pending: list.isFetching || writing,
    canUndo: state.slot?.day === day,
    selectedId: state.selectedId,
    noticeId: state.noticeId,
    focusId: state.focusId,
    totalsFacts: useTotalsFacts(day, today, list.data),
    select: state.select,
    ...edits,
    undo,
  }
}

type CorrectionState = ReturnType<typeof useCorrectionState>

// The sheet's own state: the undo slot, the selected row, the row the archived notice was raised for (until the next edit or
// selection), and the row a cut just created (the sheet focuses its header, since the pressed button left with its panel).
function useCorrectionState() {
  const [slot, setSlot] = useState<UndoSlot | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [noticeId, setNoticeId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  return {
    slot,
    selectedId,
    noticeId,
    focusId,
    setSlot,
    setNoticeId,
    setFocusId,
    select: (id: string | null): void => {
      setSelectedId(id)
      setNoticeId(null)
    },
    // A refused undo on the archived activity: select its row, so the notice is seen.
    showNotice: (id: string): void => {
      setSelectedId(id)
      setNoticeId(id)
    },
  }
}

// Every mutation here and in the undo refetches `switches.*` and `stats.*` once it settles.
function useRefetchAfterEdit() {
  const queryClient = useQueryClient()
  return {
    onSettled: async (): Promise<void> =>
      invalidateKeys(queryClient, [orpc.switches.key(), orpc.stats.key()]),
  }
}

// The sheet's edits. Each arms 元に戻す through {@link undoSlotFor} once it succeeds.
function useCorrectionEdits(
  day: string,
  listed: ListedDay | undefined,
  state: CorrectionState,
) {
  const edit = useRefetchAfterEdit()
  const moveStart = useMutation({
    ...orpc.switches.moveStart.mutationOptions(),
    ...edit,
  })
  const changeActivity = useMutation({
    ...orpc.switches.changeActivity.mutationOptions(),
    ...edit,
  })
  const mergeIntoPrevious = useMutation({
    ...orpc.switches.mergeIntoPrevious.mutationOptions(),
    ...edit,
  })
  const mergeIntoNext = useMutation({
    ...orpc.switches.mergeIntoNext.mutationOptions(),
    ...edit,
  })
  const splitInHalf = useMutation({
    ...orpc.switches.splitInHalf.mutationOptions(),
    ...edit,
  })
  const splitAt = useMutation({
    ...orpc.switches.splitAt.mutationOptions(),
    ...edit,
  })
  // The slot is decided when the button is pressed, when `listed` is still the pre-edit answer (the buttons wait for
  // fetches and writes); hook-level options are re-read at every render, so they would snapshot whatever arrived meanwhile.
  // It is armed only once the edit succeeded: a failed one (stale row, offline) must not leave rows that would overwrite
  // someone else's change. The day travels with it so a slot never replays into the next day.
  const arm = (kind: CorrectionEdit, row: CorrectionRow) => {
    state.setNoticeId(null)
    const pressed = listed
    return (): void => {
      if (!pressed) return
      const next = undoSlotFor(kind, row, day, pressed)
      const blocked = 'blocked' in next
      state.setSlot(blocked ? null : next)
      state.setNoticeId(blocked ? row.id : null)
    }
  }
  return {
    move: (row: CorrectionRow, deltaMinutes: 15 | -15): void =>
      moveStart.mutate(
        { id: row.id, deltaMinutes },
        { onSuccess: arm({ kind: 'move' }, row) },
      ),
    pick: (row: CorrectionRow, activityId: string | null): void =>
      changeActivity.mutate(pickRequest(row, activityId), {
        onSuccess: arm({ kind: 'pick', activityId }, row),
      }),
    mergePrevious: (row: CorrectionRow): void =>
      mergeIntoPrevious.mutate(
        { id: row.id },
        { onSuccess: arm({ kind: 'merge' }, row) },
      ),
    mergeNext: (row: CorrectionRow): void =>
      mergeIntoNext.mutate(
        { id: row.id },
        { onSuccess: arm({ kind: 'merge' }, row) },
      ),
    split: (row: CorrectionRow): void =>
      splitInHalf.mutate(
        { id: row.id },
        { onSuccess: arm({ kind: 'split' }, row) },
      ),
    // 「ここで分割」: the new row is selected (and focused) so the next pick changes only the later part.
    cut: (row: CorrectionRow, at: number): void => {
      const armCut = arm({ kind: 'cut' }, row)
      const input: SplitAtInput = { id: row.id, at: new Date(at) }
      splitAt.mutate(input, {
        onSuccess: (inserted) => {
          armCut()
          state.select(inserted.id)
          state.setFocusId(inserted.id)
        },
      })
    },
  }
}

// 「元に戻す」 for the armed slot. Undo is not itself undoable: pressing it twice would otherwise redo the edit. Both undo
// mutations sit under `switches.key()`, so the sheet's `writing` holds the panel while they run.
function useCorrectionUndo(state: CorrectionState) {
  const edit = useRefetchAfterEdit()
  const replaceDay = useMutation({
    ...orpc.switches.replaceDay.mutationOptions(),
    ...edit,
  })
  const restoreActivity = useMutation({
    ...orpc.switches.changeActivity.mutationOptions(),
    ...edit,
  })
  // A refused activity undo that can never succeed turns 元に戻す off; the archived one also says why on its row.
  const refuseActivityUndo = (error: unknown, id: string): void => {
    const outcome = afterUndoFailure(error)
    if (outcome !== 'keep') state.setSlot(null)
    if (outcome === 'archived') state.showNotice(id)
  }
  return (): void => {
    if (!state.slot) return
    const request = undoRequest(state.slot)
    // Dropped on success, not on mutate, so a failed day undo (offline, stale row) leaves 元に戻す armed for another try.
    if (request.procedure === 'replaceDay')
      replaceDay.mutate(request.input, {
        onSuccess: () => {
          state.setSlot(null)
          // A cut's undo brings the carried-in row back: select it again.
          if (request.reselectId) state.select(request.reselectId)
        },
      })
    else
      restoreActivity.mutate(request.input, {
        onSuccess: () => state.setSlot(null),
        onError: (error) => refuseActivityUndo(error, request.input.id),
      })
  }
}

// What the lines under 「ここで分割」 read: the idle threshold, the unused-day rule, and the viewed day's own facts.
function useTotalsFacts(
  day: string,
  today: string,
  listed: ListedDay | undefined,
): TotalsFacts {
  const { idleThresholdMinutes } = useLocalToday()
  const { settings } = useSettings()
  const excluded = useExcludedDays()
  return {
    idleThresholdMs: idleThresholdMinutes * 60_000,
    autoExcludeUnusedDays: settings.autoExcludeUnusedDays,
    manuallyExcluded: excluded.rows.some(
      (row) => row.day === day && row.reason === 'manual',
    ),
    hasOwnRows: (listed?.rows.length ?? 0) > 0,
    isToday: day === today,
  }
}

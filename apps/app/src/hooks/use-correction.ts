import { dayBounds, daySchema, type SplitAtInput } from '@switch-time/shared'
import {
  onlineManager,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useState, useSyncExternalStore } from 'react'

import { useAllActivities } from '@/hooks/use-activities'
import { useDelayedFlag } from '@/hooks/use-delayed-flag'
import { useLocalToday } from '@/hooks/use-local-today'
import { useSettings } from '@/hooks/use-settings'
import {
  afterUndoFailure,
  correctionRows,
  dayBaseline,
  dayTitle,
  isDayChangedRefusal,
  isManuallyExcluded,
  pickRequest,
  refusalMessage,
  statusLine,
  undoRequest,
  undoSlotFor,
  WRITING_LINE_DELAY_MS,
  type CorrectionEdit,
  type CorrectionRow,
  type DayBounds,
  type ListedDay,
  type TotalsFacts,
  type UndoSlot,
} from '@/lib/correction'
import { RequestTimeoutError } from '@/lib/deadline'
import { orpc, type SwitchRow } from '@/lib/orpc'
import { invalidateKeys } from '@/lib/query'
import { useAppSelector } from '@/store'

/**
 * Everything the correction sheet needs for one day: the row model, the selection, the `switches.*` edits and 「元に戻す」.
 * Every edit invalidates `switches.*` and `stats.*` (and `settings.*` after a day-changed refusal), so Home and History pick it
 * up at once. An invalid or missing `dayParam`
 * means today.
 *
 * Every edit sends the day as the sheet listed it ({@link dayBaseline}), and the API refuses it once the day reads otherwise.
 * The undo slot ({@link UndoSlot}) is one of two kinds. A `day` slot holds the day's rows before the last edit and the rows
 * it left, and writes the former back through `switches.replaceDay` only while the day still holds the latter; every edit
 * arms it, except a pick on the carried-in record, which arms an `activity` slot that puts the previous activity back
 * through `switches.changeActivity` only while the record is still at the revision the pick left (that record reaches
 * another day, which the day slot cannot rewrite). A pick away from an archived activity arms nothing and drops any older
 * slot, and raises the archived notice instead ({@link undoSlotFor}). A failed undo of either kind is sorted by
 * {@link afterUndoFailure}.
 *
 * `status` is the line under the rows ({@link statusLine}): why the last edit or undo failed ({@link refusalMessage}), until
 * the next press, selection or undo, else why the panel waits (a write landing, or queued offline).
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
  const bounds = { ...dayBounds(day, timeZone), now, timeZone }
  const edits = useCorrectionEdits(day, bounds, list.data, state)
  const undo = useCorrectionUndo(state)
  // Any switches write holds the panel, not only this sheet's: a hotkey tap, or an edit still landing from a sheet closed mid-flight.
  // A settings write in flight may move the stored zone, and with it the day's window: it holds the panel too, until it lands
  // and the day refetches, so no edit sends a baseline in the zone being replaced.
  const writesInFlight =
    useIsMutating({ mutationKey: orpc.switches.key() }) +
    useIsMutating({ mutationKey: orpc.settings.key() })
  const online = useSyncExternalStore(onlineManager.subscribe, () =>
    onlineManager.isOnline(),
  )
  const waiting = useDelayedFlag(writesInFlight > 0, WRITING_LINE_DELAY_MS)
  return {
    day,
    title: dayTitle(day, today),
    bounds,
    rows: correctionRows(list.data, activities.data, bounds),
    pending: list.isFetching || writesInFlight > 0,
    // A write stays in flight until its refetch lands (`onSettled` awaits it), so the line covers both; a quick one says nothing.
    // After a timeout the refetch runs on its own: it dims the panel through `pending`, without a line.
    status: statusLine({ refusal: state.refusal, waiting, online }),
    canUndo: state.slot?.day === day,
    selectedId: state.selectedId,
    noticeId: state.noticeId,
    focusId: state.focusId,
    totalsFacts: useTotalsFacts(day, today, list.data, ready),
    select: state.select,
    ...edits,
    undo,
  }
}

type CorrectionState = ReturnType<typeof useCorrectionState>

// The sheet's own state: the undo slot, the selected row, the row the archived notice was raised for (until the next edit or
// selection), the row a cut just created (the sheet focuses its header, since the pressed button left with its panel), and
// the last failure's message for the status line (until the next edit, selection or undo).
function useCorrectionState() {
  const [slot, setSlot] = useState<UndoSlot | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [noticeId, setNoticeId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  return {
    slot,
    selectedId,
    noticeId,
    focusId,
    refusal,
    setSlot,
    setNoticeId,
    setFocusId,
    setRefusal,
    select: (id: string | null): void => {
      setSelectedId(id)
      setNoticeId(null)
      setRefusal(null)
    },
    // A refused undo on the archived activity: select its row, so the notice is seen.
    showNotice: (id: string): void => {
      setSelectedId(id)
      setNoticeId(id)
    },
  }
}

// Every mutation here and in the undo refetches `switches.*` and `stats.*` once it settles. A day-changed refusal also refetches
// `settings.*`, since the stored zone may be what changed on another device, and the next edit would otherwise send the stale
// cached zone again. Never while a settings update is in flight: its answer could roll back the optimistic value, and that
// update refetches settings itself once it settles.
function useRefetchAfterEdit() {
  const queryClient = useQueryClient()
  return {
    onSettled: async (_data: unknown, error: unknown): Promise<void> => {
      const refetchZone =
        isDayChangedRefusal(error) &&
        queryClient.isMutating({ mutationKey: orpc.settings.key() }) === 0
      const refetch = invalidateKeys(queryClient, [
        orpc.switches.key(),
        orpc.stats.key(),
        ...(refetchZone ? [orpc.settings.key()] : []),
      ])
      // TanStack awaits this before the mutation's own onError, so a timeout's line would wait for a refetch that a hung API
      // stalls too (another 30 s and a retry). A timeout arms nothing, so its refetch runs on its own; the list's fetch still
      // holds the panel until it settles.
      if (!(error instanceof RequestTimeoutError)) await refetch
    },
  }
}

// The sheet's edits. Each sends the day's baseline and arms 元に戻す through {@link undoSlotFor} once it succeeds.
function useCorrectionEdits(
  day: string,
  bounds: DayBounds,
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
  // The baseline is taken when the button is pressed, when `listed` is still the pre-edit answer (the buttons wait for
  // fetches and writes); hook-level options are re-read at every render, so they would snapshot whatever arrived meanwhile.
  // The API refuses the edit unless the day still reads as this baseline, so a slot armed from it and the returned row is
  // exactly the day before and after the edit. It is armed only once the edit succeeded: a failed one (stale list, offline)
  // must not leave rows that would overwrite someone else's change. The day and zone travel with it so a slot never replays
  // into another day's window. A failed edit says why in the status line; a timed-out one arms nothing either, though it may
  // have landed: the refetch shows what the day now holds.
  const press = (row: CorrectionRow) => {
    state.setNoticeId(null)
    state.setRefusal(null)
    const baseline = listed
      ? dayBaseline(day, bounds.timeZone, listed)
      : undefined
    const arm =
      (kind: CorrectionEdit['kind']) =>
      (returned: SwitchRow): void => {
        // No undo for this edit (no list yet, a busy day's baseline) also drops the older one: it no longer matches the day.
        const next = undoSlotFor({ kind, returned }, row, baseline, bounds)
        const blocked = next !== null && 'blocked' in next
        state.setSlot(blocked ? null : next)
        state.setNoticeId(blocked ? row.id : null)
      }
    const fail = (error: unknown): void => {
      // A timed-out edit may have landed, so no older undo knows what the day now holds.
      if (error instanceof RequestTimeoutError) state.setSlot(null)
      state.setRefusal(refusalMessage(error))
    }
    return { baseline, arm, fail }
  }
  return {
    move: (row: CorrectionRow, deltaMinutes: 15 | -15): void => {
      const { baseline, arm, fail } = press(row)
      moveStart.mutate(
        { id: row.id, deltaMinutes, baseline },
        { onSuccess: arm('move'), onError: fail },
      )
    },
    pick: (row: CorrectionRow, activityId: string | null): void => {
      const { baseline, arm, fail } = press(row)
      changeActivity.mutate(pickRequest(row, activityId, baseline), {
        onSuccess: arm('pick'),
        onError: fail,
      })
    },
    mergePrevious: (row: CorrectionRow): void => {
      const { baseline, arm, fail } = press(row)
      mergeIntoPrevious.mutate(
        { id: row.id, baseline },
        { onSuccess: arm('merge'), onError: fail },
      )
    },
    mergeNext: (row: CorrectionRow): void => {
      const { baseline, arm, fail } = press(row)
      mergeIntoNext.mutate(
        { id: row.id, baseline },
        { onSuccess: arm('merge'), onError: fail },
      )
    },
    split: (row: CorrectionRow): void => {
      const { baseline, arm, fail } = press(row)
      splitInHalf.mutate(
        { id: row.id, baseline },
        { onSuccess: arm('split'), onError: fail },
      )
    },
    // 「ここで分割」: the new row is selected (and focused) so the next pick changes only the later part.
    cut: (row: CorrectionRow, at: number): void => {
      const { baseline, arm, fail } = press(row)
      const input: SplitAtInput = { id: row.id, at: new Date(at), baseline }
      splitAt.mutate(input, {
        onSuccess: (inserted) => {
          arm('cut')(inserted)
          state.select(inserted.id)
          state.setFocusId(inserted.id)
        },
        onError: fail,
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
  // A refused undo that can never succeed (the day or record changed elsewhere) turns 元に戻す off; a passing failure (offline,
  // server error) keeps it armed for another try. Either way the status line says why, except for an archived refusal of the
  // carried-in pick's undo, which its row's notice already explains.
  const refuseUndo = (error: unknown, id: string | null): void => {
    const outcome = afterUndoFailure(error)
    if (outcome !== 'keep') state.setSlot(null)
    if (outcome === 'archived' && id) state.showNotice(id)
    else state.setRefusal(refusalMessage(error))
  }
  return (): void => {
    if (!state.slot) return
    state.setRefusal(null)
    const request = undoRequest(state.slot)
    // Dropped on success, not on mutate, so a passing failure leaves 元に戻す armed.
    if (request.procedure === 'replaceDay')
      replaceDay.mutate(request.input, {
        onSuccess: () => {
          state.setSlot(null)
          // A cut's undo brings the carried-in row back: select it again.
          if (request.reselectId) state.select(request.reselectId)
        },
        onError: (error) => refuseUndo(error, null),
      })
    else
      restoreActivity.mutate(request.input, {
        onSuccess: () => state.setSlot(null),
        onError: (error) => refuseUndo(error, request.input.id),
      })
  }
}

// What the lines under 「ここで分割」 read: the idle threshold, the unused-day rule, and the viewed day's own facts.
function useTotalsFacts(
  day: string,
  today: string,
  listed: ListedDay | undefined,
  ready: boolean,
): TotalsFacts {
  const { settings } = useSettings()
  // The viewed day alone: the 「除外中の日」 list stops a year back, and a correction can reach further. `ready` waits for the
  // stored time zone, as the day's list does, so a default-zone "today" is never fetched first.
  const excluded = useQuery(
    orpc.excludedDays.list.queryOptions({
      input: { from: day, to: day },
      enabled: ready,
    }),
  )
  return {
    idleThresholdMs: settings.idleThresholdMinutes * 60_000,
    autoExcludeUnusedDays: settings.autoExcludeUnusedDays,
    manuallyExcluded: isManuallyExcluded(excluded.data, day),
    hasOwnRows: (listed?.rows.length ?? 0) > 0,
    isToday: day === today,
  }
}

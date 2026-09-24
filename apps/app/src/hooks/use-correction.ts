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
  landedUndo,
  pickRequest,
  refusalMessage,
  reselectedRow,
  statusLine,
  undoRequest,
  undoSlotFor,
  WRITING_LINE_DELAY_MS,
  type CorrectionEdit,
  type CorrectionRow,
  type DayBounds,
  type ListedDay,
  type Refusal,
  type TotalsFacts,
  type UndoSlot,
} from '@/lib/correction'
import { RequestTimeoutError } from '@/lib/deadline'
import { orpc, type SwitchRow } from '@/lib/orpc'
import { invalidateKeys } from '@/lib/query'
import { useAppDispatch, useAppSelector } from '@/store'
import { correctionSlice } from '@/store/correction'

const { armed, dropped } = correctionSlice.actions

/**
 * Everything the correction sheet needs for one day: the row model, the selection, the `switches.*` edits and 「元に戻す」.
 * Every edit invalidates `switches.*` and `stats.*` (and `settings.*` after a day-changed refusal), so Home and History pick it
 * up at once. An invalid or missing `dayParam`
 * means today.
 *
 * Every edit sends the day as the sheet listed it ({@link dayBaseline}), and the API refuses it once the day reads otherwise.
 * The undo slot ({@link UndoSlot}) lives in the store per day ({@link correctionSlice}), so an edit that lands after the sheet
 * closed still arms it, and reopening that day offers it. It is one of two kinds. A `day` slot holds the day's rows before the
 * last edit and the rows it left, and writes the former back through `switches.replaceDay` only while the day still holds the
 * latter; every edit arms it, except a pick on the carried-in record, which arms an `activity` slot that puts the previous
 * activity back through `switches.changeActivity` only while the record is still at the revision the pick left (that record
 * reaches another day, which the day slot cannot rewrite). A pick away from an archived activity arms nothing and drops any
 * older slot, and raises the archived notice instead ({@link undoSlotFor}). A failed undo of either kind is sorted by
 * {@link afterUndoFailure}.
 *
 * `status` is the line under the rows ({@link statusLine}): why the last edit or undo on this day failed ({@link refusalMessage}),
 * shown as soon as the answer arrives and until the next press, selection or undo, else why the panel waits (a write
 * landing, or queued offline).
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
  const slot = useAppSelector((s) => s.correction.undo[day])
  const bounds = { ...dayBounds(day, timeZone), now, timeZone }
  const edits = useCorrectionEdits(day, bounds, list.data, state)
  const undo = useCorrectionUndo(day, slot, state)
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
    status: statusLine({
      refusal: state.refusal,
      day,
      waiting,
      online,
    }),
    canUndo: slot !== undefined,
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

/** What an edit or undo keeps from its press for the hook-level callbacks (TanStack hands `onMutate`'s result to `onError`). */
type Pressed = { day: string }

// The sheet's own state: the selected row, the row the archived notice was raised for (until the next edit or selection),
// the row a cut or split just created (the sheet focuses its header, since the pressed button left with its panel), and the
// last failure for the status line (until the next edit, selection or undo). The undo slot lives in the store.
function useCorrectionState() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [noticeId, setNoticeId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  return {
    selectedId,
    noticeId,
    focusId,
    refusal,
    setNoticeId,
    setFocusId,
    setRefusal,
    // A tap on a row: what the line or the notice said was about another moment.
    select: (id: string | null): void => {
      setSelectedId(id)
      setNoticeId(null)
      setRefusal(null)
    },
    // A row the sheet selects by itself (a landed cut or split, an undo's reselect): a refusal a concurrent write raised stays.
    reveal: (id: string): void => {
      setSelectedId(id)
    },
    // A refused undo on the archived activity: select its row, so the notice is seen.
    showNotice: (id: string): void => {
      setSelectedId(id)
      setNoticeId(id)
    },
  }
}

// The hook-level callbacks of every mutation here and in the undo. `onMutate` takes the day at the press (`mutate()` calls it
// synchronously). `onError` sets the status line at once: TanStack runs it before `onSettled`, which waits for the re-read,
// and when the connection drops during that re-read its retry waits for the network with no deadline. Every mutation refetches `switches.*` and `stats.*` once it settles. A
// day-changed refusal also refetches `settings.*`, since the stored zone may be what changed on another device, and the next
// edit would otherwise send the stale cached zone again. Never while a settings update is in flight: its answer could roll
// back the optimistic value, and that update refetches settings itself once it settles.
function useEditLifecycle(day: string, state: CorrectionState) {
  const queryClient = useQueryClient()
  return {
    onMutate: (): Pressed => ({ day }),
    onError: (
      error: unknown,
      _variables: unknown,
      pressed: Pressed | undefined,
    ): void => {
      if (pressed)
        state.setRefusal({ day: pressed.day, text: refusalMessage(error) })
    },
    onSettled: async (_data: unknown, error: unknown): Promise<void> => {
      const refetchZone =
        isDayChangedRefusal(error) &&
        queryClient.isMutating({ mutationKey: orpc.settings.key() }) === 0
      const refetch = invalidateKeys(queryClient, [
        orpc.switches.key(),
        orpc.stats.key(),
        ...(refetchZone ? [orpc.settings.key()] : []),
      ])
      // The mutation stays pending until this settles, so the panel waits for the rows the edit left. A timeout arms nothing,
      // so its refetch runs on its own (a hung API stalls it too, another 30 s and a retry); the list's fetch still holds the
      // panel until it settles.
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
  const dispatch = useAppDispatch()
  const epoch = useAppSelector((s) => s.correction.epoch)
  const edit = useEditLifecycle(day, state)
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
  // fetches and writes). The API refuses the edit unless the day still reads as this baseline, so a slot armed from it and
  // the returned row is exactly the day before and after the edit. It is armed only once the edit succeeded: a failed one
  // (stale list, offline) must not leave rows that would overwrite someone else's change. The day and zone travel with it so
  // a slot never replays into another day's window. Each press settles through its own `mutateAsync` promise, so every
  // edit's answer counts, a second tap's included, and so does one that lands after the sheet closed (per-call `mutate()`
  // callbacks fire for the latest call only, and only while mounted). The store's `epoch` at the press keeps an answer that
  // lands after sign-out away from the next account. A timed-out edit arms nothing, though it may have landed: the refetch
  // shows what the day now holds. The failure's line comes from `onError` ({@link useEditLifecycle}).
  const press = (row: CorrectionRow) => {
    state.setNoticeId(null)
    state.setRefusal(null)
    const baseline = listed
      ? dayBaseline(day, bounds.timeZone, listed)
      : undefined
    const landed =
      (kind: CorrectionEdit['kind']) =>
      (returned: SwitchRow): void => {
        // No undo for this edit (no list yet, a busy day's baseline, an archived pick) also drops the older one: it no longer
        // matches the day.
        const { slot, archived } = landedUndo(
          undoSlotFor({ kind, returned }, row, baseline, bounds),
        )
        dispatch(slot ? armed({ epoch, slot }) : dropped({ epoch, day }))
        state.setNoticeId(archived ? row.id : null)
      }
    const failed = (error: unknown): void => {
      // A timed-out edit may have landed, so no older undo knows what the day now holds.
      if (error instanceof RequestTimeoutError)
        dispatch(dropped({ epoch, day }))
    }
    return { baseline, landed, failed }
  }
  // 半分で分割 and 「ここで分割」: the new row is selected (and focused) so the next pick changes only the later part.
  const reveal = (inserted: SwitchRow): void => {
    state.reveal(inserted.id)
    state.setFocusId(inserted.id)
  }
  return {
    move: (row: CorrectionRow, deltaMinutes: 15 | -15): void => {
      const { baseline, landed, failed } = press(row)
      moveStart
        .mutateAsync({ id: row.id, deltaMinutes, baseline })
        .then(landed('move'), failed)
    },
    pick: (row: CorrectionRow, activityId: string | null): void => {
      const { baseline, landed, failed } = press(row)
      changeActivity
        .mutateAsync(pickRequest(row, activityId, baseline))
        .then(landed('pick'), failed)
    },
    mergePrevious: (row: CorrectionRow): void => {
      const { baseline, landed, failed } = press(row)
      mergeIntoPrevious
        .mutateAsync({ id: row.id, baseline })
        .then(landed('merge'), failed)
    },
    mergeNext: (row: CorrectionRow): void => {
      const { baseline, landed, failed } = press(row)
      mergeIntoNext
        .mutateAsync({ id: row.id, baseline })
        .then(landed('merge'), failed)
    },
    split: (row: CorrectionRow): void => {
      const { baseline, landed, failed } = press(row)
      splitInHalf.mutateAsync({ id: row.id, baseline }).then((inserted) => {
        landed('split')(inserted)
        reveal(inserted)
      }, failed)
    },
    cut: (row: CorrectionRow, at: number): void => {
      const { baseline, landed, failed } = press(row)
      const input: SplitAtInput = { id: row.id, at: new Date(at), baseline }
      splitAt.mutateAsync(input).then((inserted) => {
        landed('cut')(inserted)
        reveal(inserted)
      }, failed)
    },
  }
}

// 「元に戻す」 for the day's armed slot. Undo is not itself undoable: pressing it twice would otherwise redo the edit. Both undo
// mutations sit under `switches.key()`, so the sheet's `writing` holds the panel while they run.
function useCorrectionUndo(
  day: string,
  slot: UndoSlot | undefined,
  state: CorrectionState,
) {
  const dispatch = useAppDispatch()
  const epoch = useAppSelector((s) => s.correction.epoch)
  const edit = useEditLifecycle(day, state)
  const replaceDay = useMutation({
    ...orpc.switches.replaceDay.mutationOptions(),
    ...edit,
  })
  const restoreActivity = useMutation({
    ...orpc.switches.changeActivity.mutationOptions(),
    ...edit,
    // An archived refusal of the carried-in pick's undo: its row's notice explains it, not the line.
    onError: (error, variables, pressed) => {
      if (afterUndoFailure(error) === 'archived') state.showNotice(variables.id)
      else edit.onError(error, variables, pressed)
    },
  })
  // A refused undo that can never succeed (the day or record changed elsewhere, an archived activity) turns 元に戻す off; a
  // passing failure (offline, server error, a timeout) keeps it armed for another try.
  const failed = (error: unknown): void => {
    if (afterUndoFailure(error) !== 'keep') dispatch(dropped({ epoch, day }))
  }
  return (): void => {
    if (!slot) return
    state.setRefusal(null)
    const request = undoRequest(slot)
    // Dropped on success, not on mutate, so a passing failure leaves 元に戻す armed.
    if (request.procedure === 'replaceDay')
      replaceDay.mutateAsync(request.input).then((written) => {
        dispatch(dropped({ epoch, day }))
        // A cut's or a split's undo brings back the row the edit was made on: select it again.
        const reselectId = reselectedRow(request.reselect, written)
        if (reselectId) state.reveal(reselectId)
      }, failed)
    else
      restoreActivity
        .mutateAsync(request.input)
        .then(() => dispatch(dropped({ epoch, day })), failed)
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

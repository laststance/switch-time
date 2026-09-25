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
  landedUndo,
  offeredUndo,
  onPressedDay,
  pickRequest,
  refusalMessage,
  reselectedRow,
  sheetView,
  statusLine,
  undoRequest,
  undoSlotFor,
  WRITING_LINE_DELAY_MS,
  type CorrectionEdit,
  type CorrectionRow,
  type CorrectionSheet,
  type DayBounds,
  type ListedDay,
  type SheetPatch,
  type TotalsFacts,
  type UndoSlot,
} from '@/lib/correction'
import { RequestTimeoutError } from '@/lib/deadline'
import { orpc, type SwitchRow } from '@/lib/orpc'
import { invalidateKeys } from '@/lib/query'
import { useAppDispatch, useAppSelector } from '@/store'
import { correctionSlice } from '@/store/correction'

const { armed, dropped, hushed, noticed, refused } = correctionSlice.actions

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
 * {@link afterUndoFailure}. A slot is offered only while the listed day still reads as it left it ({@link offeredUndo}).
 *
 * `status` is the line under the rows ({@link statusLine}): why the last edit or undo on this day failed ({@link refusalMessage}),
 * shown as soon as the answer arrives, even to a sheet reopened after it closed, and until the next press, selection or undo,
 * else why the panel waits (a write landing, or queued offline).
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
  const state = useCorrectionState(day)
  // Offered only while the listed day still reads as the slot left it: this device's own tap on ホーム, or another device's
  // edit the list has read, turns it off rather than leaving a press that can only be refused.
  const slot = offeredUndo(
    useAppSelector((s) => s.correction.undo[day]),
    list.data,
    timeZone,
  )
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
    status: statusLine({ refusal: state.refusal, waiting, online }),
    canUndo: slot !== undefined,
    selectedId: state.selectedId,
    noticeId: state.noticeId,
    focusId: state.focusId,
    totalsFacts: useTotalsFacts(day, ready),
    select: state.select,
    ...edits,
    undo,
  }
}

type CorrectionState = ReturnType<typeof useCorrectionState>

/** What an edit or undo keeps from its press for the hook-level callbacks (TanStack hands `onMutate`'s result to `onError`). */
type Pressed = { day: string; epoch: string }

// The sheet's own state ({@link CorrectionSheet}): the selected row and the row a cut or split just created (the sheet focuses
// its header, since the pressed button left with its panel). It belongs to the day shown: a new day (midnight on today's sheet,
// a `?day=` change) starts it over during render ({@link sheetView}), so an answer from a press on the day before, which
// applies only while `day` is still its own ({@link onPressedDay}), selects nothing there. What the sheet said about a day
// (the last failure's line, the archived notice) lives in the store with the undo slot, so a press whose answer lands after
// the sheet closed still says it when that day's sheet reopens; the notice's row is selected then, so its panel shows it.
function useCorrectionState(day: string) {
  const dispatch = useAppDispatch()
  const epoch = useAppSelector((s) => s.correction.epoch)
  const refusal = useAppSelector((s) => s.correction.refusal[day])
  const notice = useAppSelector((s) => s.correction.notice[day])
  const [sheet, setSheet] = useState<CorrectionSheet>({
    day,
    selectedId: null,
    focusId: null,
  })
  const view = sheetView(sheet, day, { refusal, notice })
  const current = view.sheet
  // A new day started the sheet over ("adjusting state when a prop changes"); `current` already covers this render.
  if (current !== sheet) setSheet(current)
  // An answer to a press: kept off the sheet once it shows another day.
  const answer = (pressedDay: string, patch: SheetPatch): void =>
    setSheet((latest) => onPressedDay(latest, pressedDay, patch))
  return {
    selectedId: view.selectedId,
    noticeId: view.noticeId,
    focusId: current.focusId,
    refusal: view.refusal,
    // A press on this day: what the line or the notice said was about another moment. An undo keeps the notice. The row the
    // notice selected becomes the sheet's own first, so clearing the notice leaves its panel open under the press.
    hush: (notice: boolean): void => {
      setSheet({ ...current, selectedId: view.selectedId })
      dispatch(hushed({ epoch, day, notice }))
    },
    // A tap on a row: what the line or the notice said was about another moment, except the notice of the row tapped, which
    // may have landed while another row was selected and is seen only now.
    select: (id: string | null): void => {
      setSheet({ ...current, selectedId: id })
      dispatch(hushed({ epoch, day, notice: id !== view.noticeId }))
    },
    // A row the sheet selects by itself (an undo's reselect): a refusal a concurrent write raised stays.
    reveal: (pressedDay: string, id: string): void => {
      answer(pressedDay, { selectedId: id })
    },
    // 半分で分割 and 「ここで分割」: the new row is selected (and focused) so the next pick changes only the later part.
    selectInserted: (pressedDay: string, id: string): void => {
      answer(pressedDay, { selectedId: id, focusId: id })
    },
    // An archived pick, or an undo refused as archived: the notice on the press's day, whose row is then selected.
    showNotice: (pressed: Pressed, id: string): void => {
      dispatch(noticed({ ...pressed, id }))
      answer(pressed.day, { selectedId: id })
    },
  }
}

// The hook-level callbacks of every mutation here and in the undo. `onMutate` takes the day and the store's epoch at the press
// (`mutate()` calls it synchronously). `onError` sets the day's status line at once: TanStack runs it before `onSettled`,
// which waits for the re-read, and when the connection drops during that re-read its retry waits for the network with no
// deadline. It runs even once the sheet has closed (the options stay on the mutation when its observer unsubscribes), and the
// line lives in the store, so reopening that day's sheet says why.
// Every mutation refetches `switches.*` and `stats.*` once it settles. A day-changed refusal also refetches `settings.*`, since
// the stored zone may be what changed on another device, and the next edit would otherwise send the stale cached zone again.
// Never while a settings update is in flight: its answer could roll back the optimistic value, and that update refetches
// settings itself once it settles.
function useEditLifecycle(day: string) {
  const queryClient = useQueryClient()
  const dispatch = useAppDispatch()
  const epoch = useAppSelector((s) => s.correction.epoch)
  return {
    onMutate: (): Pressed => ({ day, epoch }),
    onError: (
      error: unknown,
      _variables: unknown,
      pressed: Pressed | undefined,
    ): void => {
      if (pressed)
        dispatch(
          refused({
            ...pressed,
            text: refusalMessage(error),
          }),
        )
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
  const edit = useEditLifecycle(day)
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
  // shows what the day now holds. The failure's line comes from `onError` ({@link useEditLifecycle}). `day` here is the day
  // pressed on: an answer that lands once the sheet shows another day selects nothing there ({@link useCorrectionState}).
  const press = (row: CorrectionRow) => {
    state.hush(true)
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
        if (archived) state.showNotice({ day, epoch }, row.id)
      }
    const failed = (error: unknown): void => {
      // A timed-out edit may have landed, so no older undo knows what the day now holds.
      if (error instanceof RequestTimeoutError)
        dispatch(dropped({ epoch, day }))
    }
    return { baseline, landed, failed }
  }
  const selectInserted = (inserted: SwitchRow): void => {
    state.selectInserted(day, inserted.id)
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
        selectInserted(inserted)
      }, failed)
    },
    cut: (row: CorrectionRow, at: number): void => {
      const { baseline, landed, failed } = press(row)
      const input: SplitAtInput = { id: row.id, at: new Date(at), baseline }
      splitAt.mutateAsync(input).then((inserted) => {
        landed('cut')(inserted)
        selectInserted(inserted)
      }, failed)
    },
  }
}

// 「元に戻す」 for the day's armed slot. Undo is not itself undoable: pressing it twice would otherwise redo the edit. Both undo
// mutations sit under `switches.key()`, so the sheet's `writesInFlight` (through `pending`) holds the panel while they run.
function useCorrectionUndo(
  day: string,
  slot: UndoSlot | undefined,
  state: CorrectionState,
) {
  const dispatch = useAppDispatch()
  const epoch = useAppSelector((s) => s.correction.epoch)
  const edit = useEditLifecycle(day)
  const replaceDay = useMutation({
    ...orpc.switches.replaceDay.mutationOptions(),
    ...edit,
  })
  const restoreActivity = useMutation({
    ...orpc.switches.changeActivity.mutationOptions(),
    ...edit,
    // An archived refusal of the carried-in pick's undo: its row's notice explains it, not the line. Kept in the store like
    // the line, so it is shown on reopening that day's sheet when the answer came after it closed.
    onError: (error, variables, pressed) => {
      if (afterUndoFailure(error) === 'archived' && pressed)
        state.showNotice(pressed, variables.id)
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
    state.hush(false)
    const request = undoRequest(slot)
    // Dropped on success, not on mutate, so a passing failure leaves 元に戻す armed.
    if (request.procedure === 'replaceDay')
      replaceDay.mutateAsync(request.input).then((written) => {
        dispatch(dropped({ epoch, day }))
        // A cut's or a split's undo brings back the row the edit was made on: select it again, on that day only.
        const reselectId = reselectedRow(request.reselect, written)
        if (reselectId) state.reveal(day, reselectId)
      }, failed)
    else
      restoreActivity
        .mutateAsync(request.input)
        .then(() => dispatch(dropped({ epoch, day })), failed)
  }
}

// What the lines under 「ここで分割」 read: the idle threshold and the viewed day's class as the stats answer it.
function useTotalsFacts(day: string, ready: boolean): TotalsFacts {
  const { settings } = useSettings()
  // The server's class for the viewed day alone, so the note follows the day rule (detox cap included) instead of copying
  // it. `ready` waits for the stored time zone, as the day's list does, so a default-zone "today" is never fetched first.
  const stats = useQuery(
    orpc.stats.week.queryOptions({ input: { startDay: day }, enabled: ready }),
  )
  return {
    idleThresholdMs: settings.idleThresholdMinutes * 60_000,
    dayExcluded: stats.data?.days[0]?.excluded,
  }
}

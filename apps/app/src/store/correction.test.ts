import { configureStore } from '@reduxjs/toolkit'
import { expect, test, vi } from 'vitest'

import type { DayLine, UndoSlot } from '@/lib/correction'

import { accountChange, afterReadActions, correctionSlice } from './correction'

import { resetApp, store } from './index'

const { armed, dropped, hushed, noticed, refused } = correctionSlice.actions

// A refusal's line, answered at 1000 ms and not yet read.
const refusal = (text: string): DayLine => ({
  at: 1000,
  kind: 'refused',
  text,
  reading: false,
  seen: null,
  stale: false,
})

const pickUndo = (day: string): UndoSlot => ({
  kind: 'activity',
  day,
  id: 'carried-in',
  to: 'work',
  revision: 4,
})

test('an armed undo belongs to its own day, and dropping it leaves other days armed', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()

  // Act
  sheet.dispatch(armed({ epoch, slot: pickUndo('2026-09-24') }))
  sheet.dispatch(armed({ epoch, slot: pickUndo('2026-09-25') }))
  sheet.dispatch(dropped({ epoch, day: '2026-09-24' }))

  // Assert
  expect(sheet.getState().undo).toEqual({
    '2026-09-25': {
      kind: 'activity',
      day: '2026-09-25',
      id: 'carried-in',
      to: 'work',
      revision: 4,
    },
  })
})

test('an edit that lands after sign-out neither arms nor drops the next account’s undo', () => {
  // Arrange
  const before = store.getState().correction.epoch
  store.dispatch(resetApp())
  const after = store.getState().correction.epoch
  store.dispatch(armed({ epoch: after, slot: pickUndo('2026-09-25') }))

  // Act
  store.dispatch(armed({ epoch: before, slot: pickUndo('2026-09-24') }))
  store.dispatch(dropped({ epoch: before, day: '2026-09-25' }))

  // Assert
  expect(after).not.toBe(before)
  expect(Object.keys(store.getState().correction.undo)).toEqual(['2026-09-25'])
})

test('a sign-in as someone else in another tab clears the previous account’s undo and ignores its late edits', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  sheet.dispatch(correctionSlice.actions.accountSeen('account-a'))
  const before = sheet.getState().epoch
  sheet.dispatch(armed({ epoch: before, slot: pickUndo('2026-09-25') }))

  // Act
  sheet.dispatch(correctionSlice.actions.accountSeen('account-b'))
  sheet.dispatch(armed({ epoch: before, slot: pickUndo('2026-09-24') }))

  // Assert
  expect(sheet.getState().undo).toEqual({})
  expect(sheet.getState().account).toBe('account-b')
})

test('a session refetch for the same account keeps its armed undo', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  sheet.dispatch(correctionSlice.actions.accountSeen('account-a'))
  const { epoch } = sheet.getState()
  sheet.dispatch(armed({ epoch, slot: pickUndo('2026-09-25') }))

  // Act
  sheet.dispatch(correctionSlice.actions.accountSeen('account-a'))

  // Assert
  expect(sheet.getState().epoch).toBe(epoch)
  expect(Object.keys(sheet.getState().undo)).toEqual(['2026-09-25'])
})

test('a second edit on the same day replaces that day’s undo, so 元に戻す takes back only the latest edit', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()
  sheet.dispatch(armed({ epoch, slot: pickUndo('2026-09-25') }))

  // Act
  sheet.dispatch(
    armed({
      epoch,
      slot: {
        kind: 'activity',
        day: '2026-09-25',
        id: 'carried-in',
        to: 'sleep',
        revision: 5,
      },
    }),
  )

  // Assert
  expect(sheet.getState().undo).toEqual({
    '2026-09-25': {
      kind: 'activity',
      day: '2026-09-25',
      id: 'carried-in',
      to: 'sleep',
      revision: 5,
    },
  })
})

test('signing out clears every armed 元に戻す, so the next account starts with none', () => {
  // Arrange
  const { epoch } = store.getState().correction
  store.dispatch(armed({ epoch, slot: pickUndo('2026-09-24') }))
  store.dispatch(armed({ epoch, slot: pickUndo('2026-09-25') }))

  // Act
  store.dispatch(resetApp())

  // Assert
  expect(store.getState().correction.undo).toEqual({})
})

test('arming a day undo whose rows hold Dates raises no non-serializable warning in development', () => {
  // Arrange
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { epoch } = store.getState().correction
  const daySlot: UndoSlot = {
    kind: 'day',
    day: '2026-09-25',
    timeZone: 'Asia/Tokyo',
    rows: [
      {
        activityId: 'work',
        startedAt: new Date('2026-09-25T09:00:00+09:00'),
      },
    ],
    expected: [
      {
        id: 'w',
        activityId: 'work',
        startedAt: new Date('2026-09-25T09:00:00+09:00'),
      },
      {
        id: 'w2',
        activityId: 'work',
        startedAt: new Date('2026-09-25T10:30:00+09:00'),
      },
    ],
    carriedOutId: null,
    reselect: { startedAt: Date.parse('2026-09-25T09:00:00+09:00') },
    account: 'account-a',
  }

  // Act
  store.dispatch(armed({ epoch, slot: daySlot }))
  const warnings = consoleError.mock.calls.length
  consoleError.mockRestore()

  // Assert
  expect(warnings).toBe(0)
  expect(store.getState().correction.undo['2026-09-25']?.kind).toBe('day')
})

test('a failure that lands after its sheet closed is kept for that day only, so reopening that day says why and other days say nothing', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()

  // Act
  sheet.dispatch(
    refused({
      epoch,
      day: '2026-09-24',
      line: refusal('これ以上動かせません'),
    }),
  )

  // Assert
  expect(sheet.getState().line).toEqual({
    '2026-09-24': refusal('これ以上動かせません'),
  })
})

test('a new press on the day clears its line and its archived notice, while an undo clears the line and keeps the notice', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()
  sheet.dispatch(
    refused({
      epoch,
      day: '2026-09-24',
      line: refusal('これ以上動かせません'),
    }),
  )
  sheet.dispatch(noticed({ epoch, day: '2026-09-24', id: 'carried-in' }))
  sheet.dispatch(
    refused({
      epoch,
      day: '2026-09-25',
      line: refusal('統合できる記録がありません'),
    }),
  )

  // Act
  sheet.dispatch(hushed({ epoch, day: '2026-09-24', notice: false }))
  const afterUndo = sheet.getState()
  sheet.dispatch(hushed({ epoch, day: '2026-09-24', notice: true }))
  const afterPress = sheet.getState()

  // Assert
  expect(afterUndo.line).toEqual({
    '2026-09-25': refusal('統合できる記録がありません'),
  })
  expect(afterUndo.notice).toEqual({ '2026-09-24': 'carried-in' })
  expect(afterPress.line).toEqual({
    '2026-09-25': refusal('統合できる記録がありません'),
  })
  expect(afterPress.notice).toEqual({})
})

test('a failure or notice that lands after sign-out, or after another account signed in, says nothing to the next account', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  sheet.dispatch(correctionSlice.actions.accountSeen('account-a'))
  const before = sheet.getState().epoch
  sheet.dispatch(
    refused({
      epoch: before,
      day: '2026-09-24',
      line: refusal('これ以上動かせません'),
    }),
  )
  sheet.dispatch(
    noticed({ epoch: before, day: '2026-09-24', id: 'carried-in' }),
  )

  // Act
  sheet.dispatch(correctionSlice.actions.accountSeen('account-b'))
  sheet.dispatch(
    refused({
      epoch: before,
      day: '2026-09-25',
      line: refusal('統合できる記録がありません'),
    }),
  )
  sheet.dispatch(
    noticed({ epoch: before, day: '2026-09-25', id: 'carried-in' }),
  )
  store.dispatch(
    refused({
      epoch: store.getState().correction.epoch,
      day: '2026-09-24',
      line: refusal('これ以上動かせません'),
    }),
  )
  store.dispatch(
    noticed({
      epoch: store.getState().correction.epoch,
      day: '2026-09-24',
      id: 'carried-in',
    }),
  )
  store.dispatch(resetApp())

  // Assert
  expect(sheet.getState().line).toEqual({})
  expect(sheet.getState().notice).toEqual({})
  expect(store.getState().correction.line).toEqual({})
  expect(store.getState().correction.notice).toEqual({})
})

test('a press from before sign-out cannot clear the next account’s line or notice', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  sheet.dispatch(correctionSlice.actions.accountSeen('account-a'))
  const before = sheet.getState().epoch
  sheet.dispatch(correctionSlice.actions.accountSeen('account-b'))
  const after = sheet.getState().epoch
  sheet.dispatch(
    refused({
      epoch: after,
      day: '2026-09-24',
      line: refusal('これ以上動かせません'),
    }),
  )
  sheet.dispatch(noticed({ epoch: after, day: '2026-09-24', id: 'carried-in' }))

  // Act
  sheet.dispatch(hushed({ epoch: before, day: '2026-09-24', notice: true }))

  // Assert
  expect(sheet.getState().line).toEqual({
    '2026-09-24': refusal('これ以上動かせません'),
  })
  expect(sheet.getState().notice).toEqual({ '2026-09-24': 'carried-in' })
})

test('a session refetch for the same account keeps each day’s line and notice', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  sheet.dispatch(correctionSlice.actions.accountSeen('account-a'))
  const { epoch } = sheet.getState()
  sheet.dispatch(
    refused({
      epoch,
      day: '2026-09-24',
      line: refusal('これ以上動かせません'),
    }),
  )
  sheet.dispatch(noticed({ epoch, day: '2026-09-24', id: 'carried-in' }))

  // Act
  sheet.dispatch(correctionSlice.actions.accountSeen('account-a'))

  // Assert
  expect(sheet.getState().line).toEqual({
    '2026-09-24': refusal('これ以上動かせません'),
  })
  expect(sheet.getState().notice).toEqual({ '2026-09-24': 'carried-in' })
})

test('a second failure on the same day replaces its line, so the line names the latest failure', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()
  sheet.dispatch(
    refused({
      epoch,
      day: '2026-09-24',
      line: refusal('これ以上動かせません'),
    }),
  )

  // Act
  sheet.dispatch(
    refused({
      epoch,
      day: '2026-09-24',
      line: refusal('統合できる記録がありません'),
    }),
  )

  // Assert
  expect(sheet.getState().line).toEqual({
    '2026-09-24': refusal('統合できる記録がありません'),
  })
})

test('a sign-in as someone else in another tab drops the cached queries too, while the first account after a reset only claims the slots', () => {
  // Arrange
  const firstSinceReset = { seen: null, account: 'account-a' }
  const someoneElse = { seen: 'account-a', account: 'account-b' }

  // Act
  const claimed = accountChange(firstSinceReset.seen, firstSinceReset.account)
  const switched = accountChange(someoneElse.seen, someoneElse.account)

  // Assert
  expect(claimed).toEqual({ account: 'account-a', switched: false })
  expect(switched).toEqual({ account: 'account-b', switched: true })
})

test('a session refetch for the same account, or a signed-out moment, changes nothing', () => {
  // Arrange
  const seen = 'account-a'

  // Act
  const refetched = accountChange(seen, 'account-a')
  const signedOut = accountChange(seen, undefined)

  // Assert
  expect(refetched).toBeNull()
  expect(signedOut).toBeNull()
})

test('a read settles the failure it judged: it records what it saw, marks the line stale, or expires it', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()
  const { lineRead, lineUnread, lineExpired } = correctionSlice.actions
  const uncertain: DayLine = {
    at: 1000,
    kind: 'uncertain',
    text: '反映されたか分かりませんでした。一覧で確かめてください',
    reading: true,
    seen: null,
    stale: false,
  }
  sheet.dispatch(refused({ epoch, day: '2026-09-24', line: uncertain }))
  sheet.dispatch(refused({ epoch, day: '2026-09-25', line: uncertain }))
  sheet.dispatch(refused({ epoch, day: '2026-09-26', line: uncertain }))

  // Act
  sheet.dispatch(
    lineRead({ epoch, day: '2026-09-24', at: 1000, seen: 'day-a' }),
  )
  sheet.dispatch(lineUnread({ epoch, day: '2026-09-25', at: 1000 }))
  sheet.dispatch(lineExpired({ epoch, day: '2026-09-26', at: 1000 }))

  // Assert
  expect(sheet.getState().line).toEqual({
    '2026-09-24': { ...uncertain, reading: false, seen: 'day-a' },
    '2026-09-25': { ...uncertain, reading: false, stale: true },
  })
})

test('a read that judged an older failure leaves the newer failure’s line alone', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()
  const { lineRead, lineUnread, lineExpired } = correctionSlice.actions
  const newer: DayLine = {
    at: 2000,
    kind: 'refused',
    text: 'これ以上動かせません',
    reading: false,
    seen: null,
    stale: false,
  }
  sheet.dispatch(refused({ epoch, day: '2026-09-24', line: newer }))

  // Act
  sheet.dispatch(
    lineRead({ epoch, day: '2026-09-24', at: 1000, seen: 'day-a' }),
  )
  sheet.dispatch(lineUnread({ epoch, day: '2026-09-24', at: 1000 }))
  sheet.dispatch(lineExpired({ epoch, day: '2026-09-24', at: 1000 }))

  // Assert
  expect(sheet.getState().line).toEqual({ '2026-09-24': newer })
})

test('a read that retires 元に戻す spares a slot an edit armed after that read', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()
  const judged = pickUndo('2026-09-24')
  const armedLater = { ...pickUndo('2026-09-24'), revision: 5 }
  sheet.dispatch(armed({ epoch, slot: judged }))
  sheet.dispatch(armed({ epoch, slot: armedLater }))

  // Act
  sheet.dispatch(
    correctionSlice.actions.undoRetired({
      epoch,
      day: '2026-09-24',
      slot: judged,
    }),
  )

  // Assert
  expect(sheet.getState().undo['2026-09-24']).toEqual({
    kind: 'activity',
    day: '2026-09-24',
    id: 'carried-in',
    to: 'work',
    revision: 5,
  })
})

test('a read that retires the slot it judged turns 元に戻す off for that day', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()
  const judged = pickUndo('2026-09-24')
  sheet.dispatch(armed({ epoch, slot: judged }))

  // Act
  sheet.dispatch(
    correctionSlice.actions.undoRetired({
      epoch,
      day: '2026-09-24',
      slot: judged,
    }),
  )

  // Assert
  expect(sheet.getState().undo).toEqual({})
})

test('a read’s answer becomes the line’s action for the failure it judged, then the undo’s retirement', () => {
  // Arrange
  const epoch = 'epoch-1'
  const day = '2026-09-24'
  const line = refusal('これ以上動かせません')
  const slot = pickUndo(day)

  // Act
  const seen = afterReadActions(
    { line: { seen: 'day-a' }, retireUndo: true },
    { epoch, day, line, slot },
  )
  const unread = afterReadActions(
    { line: 'unread', retireUndo: false },
    { epoch, day, line, slot },
  )
  const expired = afterReadActions(
    { line: 'expire', retireUndo: false },
    { epoch, day, line, slot: undefined },
  )
  const nothing = afterReadActions(
    { line: 'keep', retireUndo: true },
    { epoch, day, line: undefined, slot: undefined },
  )

  // Assert
  expect(seen).toEqual([
    {
      type: 'correction/lineRead',
      payload: { epoch, day, at: 1000, seen: 'day-a' },
    },
    { type: 'correction/undoRetired', payload: { epoch, day, slot } },
  ])
  expect(unread).toEqual([
    { type: 'correction/lineUnread', payload: { epoch, day, at: 1000 } },
  ])
  expect(expired).toEqual([
    { type: 'correction/lineExpired', payload: { epoch, day, at: 1000 } },
  ])
  expect(nothing).toEqual([])
})

test('a read judged under the previous account neither settles the next account’s line nor retires its 元に戻す', () => {
  // Arrange: account B, signed in after account A, has an uncertain line and an armed undo on the same day.
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  sheet.dispatch(correctionSlice.actions.accountSeen('account-a'))
  const before = sheet.getState().epoch
  sheet.dispatch(correctionSlice.actions.accountSeen('account-b'))
  const after = sheet.getState().epoch
  const { lineRead, lineUnread, lineExpired, undoRetired } =
    correctionSlice.actions
  const uncertain: DayLine = {
    at: 1000,
    kind: 'uncertain',
    text: '反映されたか分かりませんでした。一覧で確かめてください',
    reading: true,
    seen: null,
    stale: false,
  }
  const slot = pickUndo('2026-09-24')
  sheet.dispatch(refused({ epoch: after, day: '2026-09-24', line: uncertain }))
  sheet.dispatch(armed({ epoch: after, slot }))

  // Act
  sheet.dispatch(
    lineRead({ epoch: before, day: '2026-09-24', at: 1000, seen: 'day-a' }),
  )
  sheet.dispatch(lineUnread({ epoch: before, day: '2026-09-24', at: 1000 }))
  sheet.dispatch(lineExpired({ epoch: before, day: '2026-09-24', at: 1000 }))
  sheet.dispatch(undoRetired({ epoch: before, day: '2026-09-24', slot }))

  // Assert
  expect(sheet.getState().line).toEqual({
    '2026-09-24': {
      at: 1000,
      kind: 'uncertain',
      text: '反映されたか分かりませんでした。一覧で確かめてください',
      reading: true,
      seen: null,
      stale: false,
    },
  })
  expect(sheet.getState().undo).toEqual({
    '2026-09-24': {
      kind: 'activity',
      day: '2026-09-24',
      id: 'carried-in',
      to: 'work',
      revision: 4,
    },
  })
})

test('a read of a day with no line and no 元に戻す leaves the other days alone', () => {
  // Arrange: only 2026-09-25 has a line and an armed undo.
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()
  const { lineRead, lineUnread, lineExpired, undoRetired } =
    correctionSlice.actions
  sheet.dispatch(
    refused({
      epoch,
      day: '2026-09-25',
      line: refusal('これ以上動かせません'),
    }),
  )
  sheet.dispatch(armed({ epoch, slot: pickUndo('2026-09-25') }))

  // Act
  sheet.dispatch(
    lineRead({ epoch, day: '2026-09-24', at: 1000, seen: 'day-a' }),
  )
  sheet.dispatch(lineUnread({ epoch, day: '2026-09-24', at: 1000 }))
  sheet.dispatch(lineExpired({ epoch, day: '2026-09-24', at: 1000 }))
  sheet.dispatch(
    undoRetired({ epoch, day: '2026-09-24', slot: pickUndo('2026-09-24') }),
  )

  // Assert
  expect(sheet.getState().line).toEqual({
    '2026-09-25': refusal('これ以上動かせません'),
  })
  expect(sheet.getState().undo).toEqual({
    '2026-09-25': {
      kind: 'activity',
      day: '2026-09-25',
      id: 'carried-in',
      to: 'work',
      revision: 4,
    },
  })
})

test('a read that keeps the line can still retire 元に戻す, and a verdict on a line nobody kept dispatches nothing', () => {
  // Arrange
  const epoch = 'epoch-1'
  const day = '2026-09-24'
  const line = refusal('これ以上動かせません')
  const slot = pickUndo(day)

  // Act
  const retireOnly = afterReadActions(
    { line: 'keep', retireUndo: true },
    { epoch, day, line, slot },
  )
  const noLine = afterReadActions(
    { line: 'expire', retireUndo: false },
    { epoch, day, line: undefined, slot },
  )

  // Assert
  expect(retireOnly).toEqual([
    { type: 'correction/undoRetired', payload: { epoch, day, slot } },
  ])
  expect(noLine).toEqual([])
})

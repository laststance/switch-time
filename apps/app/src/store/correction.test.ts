import { configureStore } from '@reduxjs/toolkit'
import { expect, test, vi } from 'vitest'

import type { UndoSlot } from '@/lib/correction'

import { accountChange, correctionSlice } from './correction'

import { resetApp, store } from './index'

const { armed, dropped, hushed, noticed, refused } = correctionSlice.actions

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
    refused({ epoch, day: '2026-09-24', text: 'これ以上動かせません' }),
  )

  // Assert
  expect(sheet.getState().refusal).toEqual({
    '2026-09-24': 'これ以上動かせません',
  })
})

test('a new press on the day clears its line and its archived notice, while an undo clears the line and keeps the notice', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()
  sheet.dispatch(
    refused({ epoch, day: '2026-09-24', text: 'これ以上動かせません' }),
  )
  sheet.dispatch(noticed({ epoch, day: '2026-09-24', id: 'carried-in' }))
  sheet.dispatch(
    refused({ epoch, day: '2026-09-25', text: '統合できる記録がありません' }),
  )

  // Act
  sheet.dispatch(hushed({ epoch, day: '2026-09-24', notice: false }))
  const afterUndo = sheet.getState()
  sheet.dispatch(hushed({ epoch, day: '2026-09-24', notice: true }))
  const afterPress = sheet.getState()

  // Assert
  expect(afterUndo.refusal).toEqual({
    '2026-09-25': '統合できる記録がありません',
  })
  expect(afterUndo.notice).toEqual({ '2026-09-24': 'carried-in' })
  expect(afterPress.refusal).toEqual({
    '2026-09-25': '統合できる記録がありません',
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
      text: 'これ以上動かせません',
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
      text: '統合できる記録がありません',
    }),
  )
  sheet.dispatch(
    noticed({ epoch: before, day: '2026-09-25', id: 'carried-in' }),
  )
  store.dispatch(
    refused({
      epoch: store.getState().correction.epoch,
      day: '2026-09-24',
      text: 'これ以上動かせません',
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
  expect(sheet.getState().refusal).toEqual({})
  expect(sheet.getState().notice).toEqual({})
  expect(store.getState().correction.refusal).toEqual({})
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
    refused({ epoch: after, day: '2026-09-24', text: 'これ以上動かせません' }),
  )
  sheet.dispatch(noticed({ epoch: after, day: '2026-09-24', id: 'carried-in' }))

  // Act
  sheet.dispatch(hushed({ epoch: before, day: '2026-09-24', notice: true }))

  // Assert
  expect(sheet.getState().refusal).toEqual({
    '2026-09-24': 'これ以上動かせません',
  })
  expect(sheet.getState().notice).toEqual({ '2026-09-24': 'carried-in' })
})

test('a session refetch for the same account keeps each day’s line and notice', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  sheet.dispatch(correctionSlice.actions.accountSeen('account-a'))
  const { epoch } = sheet.getState()
  sheet.dispatch(
    refused({ epoch, day: '2026-09-24', text: 'これ以上動かせません' }),
  )
  sheet.dispatch(noticed({ epoch, day: '2026-09-24', id: 'carried-in' }))

  // Act
  sheet.dispatch(correctionSlice.actions.accountSeen('account-a'))

  // Assert
  expect(sheet.getState().refusal).toEqual({
    '2026-09-24': 'これ以上動かせません',
  })
  expect(sheet.getState().notice).toEqual({ '2026-09-24': 'carried-in' })
})

test('a second failure on the same day replaces its line, so the line names the latest failure', () => {
  // Arrange
  const sheet = configureStore({ reducer: correctionSlice.reducer })
  const { epoch } = sheet.getState()
  sheet.dispatch(
    refused({ epoch, day: '2026-09-24', text: 'これ以上動かせません' }),
  )

  // Act
  sheet.dispatch(
    refused({ epoch, day: '2026-09-24', text: '統合できる記録がありません' }),
  )

  // Assert
  expect(sheet.getState().refusal).toEqual({
    '2026-09-24': '統合できる記録がありません',
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

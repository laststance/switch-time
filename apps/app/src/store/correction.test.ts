import { configureStore } from '@reduxjs/toolkit'
import { expect, test, vi } from 'vitest'

import type { UndoSlot } from '@/lib/correction'

import { correctionSlice } from './correction'

import { resetApp, store } from './index'

const { armed, dropped } = correctionSlice.actions

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
  }

  // Act
  store.dispatch(armed({ epoch, slot: daySlot }))
  const warnings = consoleError.mock.calls.length
  consoleError.mockRestore()

  // Assert
  expect(warnings).toBe(0)
  expect(store.getState().correction.undo['2026-09-25']?.kind).toBe('day')
})

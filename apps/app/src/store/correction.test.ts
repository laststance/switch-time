import { configureStore } from '@reduxjs/toolkit'
import { expect, test } from 'vitest'

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

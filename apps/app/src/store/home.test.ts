import { expect, test } from 'vitest'

import { correctionSlice } from './correction'
import { homeSlice } from './home'

const { tapPressed, tapRefused } = homeSlice.actions

test('a refused tap leaves ホーム’s refusal line saying why', () => {
  // Act
  const state = homeSlice.reducer(
    undefined,
    tapRefused('処理が混み合っています。少し待ってからもう一度お試しください'),
  )

  // Assert
  expect(state.tapRefusal).toBe(
    '処理が混み合っています。少し待ってからもう一度お試しください',
  )
})

test('the next tap clears ホーム’s refusal line', () => {
  // Arrange
  const refused = homeSlice.reducer(
    undefined,
    tapRefused('保存できませんでした。もう一度お試しください'),
  )

  // Act
  const state = homeSlice.reducer(refused, tapPressed())

  // Assert
  expect(state.tapRefusal).toBeNull()
})

test('another account signing in in another tab clears ホーム’s refusal line about the previous account’s tap', () => {
  // Arrange
  const refused = homeSlice.reducer(
    undefined,
    tapRefused('保存できませんでした。もう一度お試しください'),
  )

  // Act
  const state = homeSlice.reducer(
    refused,
    correctionSlice.actions.accountSeen('user-2'),
  )

  // Assert
  expect(state.tapRefusal).toBeNull()
})

import { expect, test } from 'vitest'

import { pressLook } from './press'

test('a target that can be pressed answers a press at 70 % opacity', () => {
  // Arrange
  const disabled = false

  // Act
  const look = pressLook(disabled)

  // Assert
  expect(look).toBe('active:opacity-70')
})

test('a disabled target stays at 40 % and never takes the pressed look, which web would otherwise apply to it', () => {
  // Arrange
  const disabled = true

  // Act
  const look = pressLook(disabled)

  // Assert
  expect(look).toBe('opacity-40')
})

test('a disabled option in a group that already dims itself adds no dimming, or the option would show at 16 %', () => {
  // Arrange
  const disabled = true
  const dimmedByParent = true

  // Act
  const look = pressLook(disabled, dimmedByParent)

  // Assert
  expect(look).toBe('')
})

test('an enabled option in a group that dims itself still answers a press at 70 %', () => {
  // Arrange
  const disabled = false
  const dimmedByParent = true

  // Act
  const look = pressLook(disabled, dimmedByParent)

  // Assert
  expect(look).toBe('active:opacity-70')
})

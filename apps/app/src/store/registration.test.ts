import { expect, test } from 'vitest'

import { registrationSlice } from './registration'

const { registered, noticeDismissed } = registrationSlice.actions

test('a registration hands its address to sign-in with the notice showing', () => {
  // Act
  const state = registrationSlice.reducer(
    undefined,
    registered('new@example.com'),
  )

  // Assert
  expect(state.current).toEqual({
    email: 'new@example.com',
    id: expect.any(String),
    notice: true,
  })
})

test('dismissing the notice keeps the address and the form key, so typed text is not wiped', () => {
  // Arrange
  const before = registrationSlice.reducer(
    undefined,
    registered('new@example.com'),
  )

  // Act
  const after = registrationSlice.reducer(before, noticeDismissed())

  // Assert
  expect(after.current).toEqual({
    email: 'new@example.com',
    id: before.current?.id,
    notice: false,
  })
})

test('a second registration after a store reset gets a new form key, so sign-in refills with the new address', () => {
  // Arrange: sign-up's success resets the whole store before it registers.
  const first = registrationSlice.reducer(
    undefined,
    registered('first@example.com'),
  )
  const reset = registrationSlice.reducer(undefined, { type: 'app/reset' })

  // Act
  const second = registrationSlice.reducer(
    reset,
    registered('second@example.com'),
  )

  // Assert
  expect(second.current?.email).toBe('second@example.com')
  expect(second.current?.id).not.toBe(first.current?.id)
})

test('dismissing with nothing registered leaves sign-in blank', () => {
  // Act
  const state = registrationSlice.reducer(undefined, noticeDismissed())

  // Assert
  expect(state.current).toBeNull()
})

import { expect, test } from 'vitest'

import { registrationSlice } from './registration'

import { resetApp, store } from './index'

const { registered, noticeDismissed } = registrationSlice.actions

test('a registration hands its address to sign-in with the notice showing', () => {
  // Act
  const state = registrationSlice.reducer(
    undefined,
    registered('new@example.com', false),
  )

  // Assert
  expect(state.current).toEqual({
    email: 'new@example.com',
    confirmByMail: false,
    id: expect.any(String),
    notice: true,
  })
})

test('a registration that mailed a confirmation link remembers it, so sign-in says to open the link first', () => {
  // Act
  const state = registrationSlice.reducer(
    undefined,
    registered('mailed@example.com', true),
  )

  // Assert
  expect(state.current).toEqual({
    email: 'mailed@example.com',
    confirmByMail: true,
    id: expect.any(String),
    notice: true,
  })
})

test('dismissing the notice keeps the address and the form key, so typed text is not wiped', () => {
  // Arrange
  const before = registrationSlice.reducer(
    undefined,
    registered('new@example.com', false),
  )

  // Act
  const after = registrationSlice.reducer(before, noticeDismissed())

  // Assert
  expect(after.current).toEqual({
    email: 'new@example.com',
    confirmByMail: false,
    id: before.current?.id,
    notice: false,
  })
})

test('a second registration after a store reset gets a new form key, so sign-in refills with the new address', () => {
  // Arrange: sign-up's success resets the whole store before it registers.
  const first = registrationSlice.reducer(
    undefined,
    registered('first@example.com', false),
  )
  const reset = registrationSlice.reducer(undefined, { type: 'app/reset' })

  // Act
  const second = registrationSlice.reducer(
    reset,
    registered('second@example.com', false),
  )

  // Assert
  expect(second.current?.email).toBe('second@example.com')
  expect(second.current?.id).not.toBe(first.current?.id)
})

test('a store reset on sign-in or sign-out forgets the registered address and its notice', () => {
  // Arrange
  store.dispatch(registered('left-behind@example.com', false))

  // Act
  store.dispatch(resetApp())

  // Assert
  expect(store.getState().registration.current).toBeNull()
})

test('dismissing with nothing registered leaves sign-in blank', () => {
  // Act
  const state = registrationSlice.reducer(undefined, noticeDismissed())

  // Assert
  expect(state.current).toBeNull()
})

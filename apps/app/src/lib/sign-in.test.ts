import { expect, test } from 'vitest'

import { keptFormKey, signInBusy, signInStart } from './sign-in'

test('sign-in opened directly starts blank, with no notice and no forced focus', () => {
  // Act
  const start = signInStart(null)

  // Assert
  expect(start).toEqual({
    key: 'blank',
    email: '',
    notice: null,
    focusPassword: false,
  })
})

test('sign-in right after 登録 fills in the address, focuses the password and says the account was made', () => {
  // Act
  const start = signInStart({
    id: 'r1',
    email: 'new@example.com',
    notice: true,
  })

  // Assert
  expect(start).toEqual({
    key: 'r1',
    email: 'new@example.com',
    notice: '登録しました。サインインしてください',
    focusPassword: true,
  })
})

test('once the notice is dismissed the address and the form key stay, so the form is not refilled', () => {
  // Act
  const start = signInStart({
    id: 'r1',
    email: 'new@example.com',
    notice: false,
  })

  // Assert
  expect(start).toEqual({
    key: 'r1',
    email: 'new@example.com',
    notice: null,
    focusPassword: true,
  })
})

test('sign-in keeps its form when its own success clears the registration, so the sent address stays on screen', () => {
  // Act
  const key = keptFormKey('r1', 'blank')

  // Assert
  expect(key).toBe('r1')
})

test('a new registration replaces the form, so sign-in refills with the new address', () => {
  // Act
  const key = keptFormKey('r1', 'r2')

  // Assert
  expect(key).toBe('r2')
})

test('sign-in opened directly and then handed a registration takes the registration', () => {
  // Act
  const key = keptFormKey('blank', 'r1')

  // Assert
  expect(key).toBe('r1')
})

test('the sign-in button waits while the request runs', () => {
  // Act
  const busy = signInBusy(
    { pending: true, succeeded: false },
    { pending: false, reloadStarted: false },
  )

  // Assert
  expect(busy).toBe(true)
})

test('the sign-in button stays off in the moment between the request going through and the session starting to reload', () => {
  // Act
  const busy = signInBusy(
    { pending: false, succeeded: true },
    { pending: false, reloadStarted: false },
  )

  // Assert
  expect(busy).toBe(true)
})

test('the sign-in button stays off after the request went through until the session lands, so a second tap cannot send it again', () => {
  // Act
  const busy = signInBusy(
    { pending: false, succeeded: true },
    { pending: true, reloadStarted: true },
  )

  // Assert
  expect(busy).toBe(true)
})

test('the sign-in button comes back when the session never loads after a sign-in went through', () => {
  // Act
  const busy = signInBusy(
    { pending: false, succeeded: true },
    { pending: false, reloadStarted: true },
  )

  // Assert
  expect(busy).toBe(false)
})

test('the sign-in button is on for a form that has not been sent, even while the first session answer loads', () => {
  // Act
  const busy = signInBusy(
    { pending: false, succeeded: false },
    { pending: true, reloadStarted: false },
  )

  // Assert
  expect(busy).toBe(false)
})

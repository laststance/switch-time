import { expect, test } from 'vitest'

import {
  keptFormKey,
  signInArrival,
  signInBusy,
  signInError,
  signInStart,
} from './sign-in'

test('sign-in opened directly starts blank, with no notice and no forced focus', () => {
  // Act
  const start = signInStart(null, null)

  // Assert
  expect(start).toEqual({
    key: 'blank',
    email: '',
    notice: null,
    error: null,
    focusPassword: false,
  })
})

test('sign-in right after 登録 fills in the address, focuses the password and says the account was made', () => {
  // Act
  const start = signInStart(
    { id: 'r1', email: 'new@example.com', confirmByMail: false, notice: true },
    null,
  )

  // Assert
  expect(start).toEqual({
    key: 'r1',
    email: 'new@example.com',
    notice: '登録しました。サインインしてください',
    error: null,
    focusPassword: true,
  })
})

test('once the notice is dismissed the address and the form key stay, so the form is not refilled', () => {
  // Act
  const start = signInStart(
    { id: 'r1', email: 'new@example.com', confirmByMail: false, notice: false },
    null,
  )

  // Assert
  expect(start).toEqual({
    key: 'r1',
    email: 'new@example.com',
    notice: null,
    error: null,
    focusPassword: true,
  })
})

test('sign-in right after 登録 with a mail server says to open the mailed link first, since the account cannot sign in yet', () => {
  // Act
  const start = signInStart(
    { id: 'r1', email: 'new@example.com', confirmByMail: true, notice: true },
    null,
  )

  // Assert
  expect(start.notice).toBe(
    '登録しました。確認メールのリンクを開いてから、サインインしてください',
  )
})

test('sign-in reached from the confirmation link says the address is confirmed, with a blank form', () => {
  // Act
  const start = signInStart(null, 'verified')

  // Assert
  expect(start).toEqual({
    key: 'blank',
    email: '',
    notice: 'メールアドレスを確認しました。サインインしてください',
    error: null,
    focusPassword: false,
  })
})

test('sign-in reached after a password reset says the password changed', () => {
  // Act
  const start = signInStart(null, 'reset')

  // Assert
  expect(start.notice).toBe(
    'パスワードを変えました。新しいパスワードでサインインしてください',
  )
})

test('sign-in reached by a confirmation link that no longer works says it expired and that signing in mails a new one', () => {
  // Act
  const start = signInStart(null, 'link-failed')

  // Assert
  expect(start.notice).toBeNull()
  expect(start.error).toBe(
    'リンクの期限が切れています。サインインすると、確認メールをもう一度お送りします',
  )
})

test('a registration wins over the link it came with, so the address just registered is not lost', () => {
  // Act
  const start = signInStart(
    { id: 'r1', email: 'new@example.com', confirmByMail: false, notice: true },
    'verified',
  )

  // Assert
  expect(start.email).toBe('new@example.com')
  expect(start.notice).toBe('登録しました。サインインしてください')
})

test('a failed try replaces the expired-link line in the alert box, and the line comes back only while there is no error', () => {
  // Arrange
  const start = signInStart(null, 'link-failed')

  // Act
  const lines = [
    signInError('メールアドレスかパスワードが違います', start),
    signInError(null, start),
    signInError(null, signInStart(null, null)),
  ]

  // Assert
  expect(lines).toEqual([
    'メールアドレスかパスワードが違います',
    'リンクの期限が切れています。サインインすると、確認メールをもう一度お送りします',
    null,
  ])
})

test('the sign-in query tells the confirmation link, the finished reset and a used-up link apart', () => {
  // Act
  const arrivals = [
    signInArrival({ verified: '1' }),
    signInArrival({ reset: '1' }),
    signInArrival({ error: 'invalid_token' }),
    signInArrival({ error: 'invalid_token', verified: '1' }),
    signInArrival({ verified: '0' }),
    signInArrival({}),
  ]

  // Assert
  expect(arrivals).toEqual([
    'verified',
    'reset',
    'link-failed',
    'link-failed',
    null,
    null,
  ])
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

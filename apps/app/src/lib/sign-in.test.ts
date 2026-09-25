import { expect, test } from 'vitest'

import { signInStart } from './sign-in'

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

import { expect, test } from 'vitest'

import { authErrorMessage, resetScreenError } from './auth-errors'

test('a wrong password says so in Japanese instead of Better Auth’s English message', () => {
  // Arrange
  const error = {
    code: 'INVALID_EMAIL_OR_PASSWORD',
    status: 401,
    message: 'Invalid email or password',
  }

  // Act
  const message = authErrorMessage(error)

  // Assert
  expect(message).toBe('メールアドレスかパスワードが違います')
})

test('the rate limit, which has a status but no code, asks the user to wait', () => {
  // Arrange
  const error = {
    status: 429,
    message: 'Too many requests. Please try again later.',
  }

  // Act
  const message = authErrorMessage(error)

  // Assert
  expect(message).toBe(
    '短い間に何度も試されました。少し待ってからもう一度お試しください',
  )
})

test('a password the server finds too short or too long reads as the form’s own inline messages do', () => {
  // Arrange
  const tooShort = { code: 'PASSWORD_TOO_SHORT', status: 400 }
  const tooLong = { code: 'PASSWORD_TOO_LONG', status: 400 }

  // Act
  const messages = [authErrorMessage(tooShort), authErrorMessage(tooLong)]

  // Assert
  expect(messages).toEqual([
    'パスワードは8文字以上にしてください',
    'パスワードは128文字以内にしてください',
  ])
})

test('an address the server refuses reads as the form’s own inline message does', () => {
  // Arrange
  const error = { code: 'INVALID_EMAIL', status: 400 }

  // Act
  const message = authErrorMessage(error)

  // Assert
  expect(message).toBe('メールアドレスの形式が正しくありません')
})

test('every refusal to register gets one wording, so sign-up does not tell whether an address has an account', () => {
  // Arrange
  const refusals = [
    { code: 'FAILED_TO_CREATE_USER', status: 422 },
    { code: 'USER_ALREADY_EXISTS', status: 422 },
    { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', status: 422 },
  ]

  // Act
  const messages = refusals.map(authErrorMessage)

  // Assert
  expect(messages).toEqual([
    '登録できませんでした。もう一度お試しください',
    '登録できませんでした。もう一度お試しください',
    '登録できませんでした。もう一度お試しください',
  ])
})

test('a sign-in before the address is confirmed says a link was mailed again, so the user looks in the inbox instead of retyping the password', () => {
  // Arrange
  const error = { code: 'EMAIL_NOT_VERIFIED', status: 403 }

  // Act
  const message = authErrorMessage(error)

  // Assert
  expect(message).toBe(
    'メールアドレスの確認がまだです。届いたメールのリンクを開いてください（確認メールを送り直しました）',
  )
})

test('a spoiled or used reset link says it expired and points to asking again', () => {
  // Arrange
  const error = { code: 'INVALID_TOKEN', status: 400 }

  // Act
  const message = authErrorMessage(error)

  // Assert
  expect(message).toBe(
    'リンクの期限が切れています。もう一度、再設定のメールを送ってください',
  )
})

test('the reset screen says the link expired when it arrives with no token or with an error, before any password is typed', () => {
  // Act
  const lines = [
    resetScreenError(null, undefined, undefined),
    resetScreenError(null, 'abc', 'INVALID_TOKEN'),
  ]

  // Assert
  expect(lines).toEqual([
    'リンクの期限が切れています。もう一度、再設定のメールを送ってください',
    'リンクの期限が切れています。もう一度、再設定のメールを送ってください',
  ])
})

test('the reset screen shows nothing for a link with a token, and the server’s own answer once a try was sent', () => {
  // Act
  const fresh = resetScreenError(null, 'abc', undefined)
  const refused = resetScreenError('もう一度お試しください', 'abc', undefined)

  // Assert
  expect(fresh).toBeNull()
  expect(refused).toBe('もう一度お試しください')
})

test('an unknown code, an error with no code and a request that never reached the server all ask to try again, never in English', () => {
  // Arrange
  const errors = [
    { code: 'SOMETHING_NEW', status: 500, message: 'Something new' },
    { status: 500, message: 'Internal Server Error' },
    { code: 'constructor', status: 400 },
    {},
  ]

  // Act
  const messages = errors.map(authErrorMessage)

  // Assert
  expect(messages).toEqual([
    'もう一度お試しください',
    'もう一度お試しください',
    'もう一度お試しください',
    'もう一度お試しください',
  ])
})

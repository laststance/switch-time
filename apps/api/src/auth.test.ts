import { expect, test } from 'vitest'

import { cookieJar, rpc, signUp } from './test/client'

test('sign-up creates a session cookie', async () => {
  // Act
  const response = await signUp('cookie@example.com')

  // Assert
  expect(response.status).toBe(200)
  expect(cookieJar(response)).toMatch(/better-auth\.session_token=\S+/)
})

test('an authed procedure returns the current user', async () => {
  // Arrange
  const cookie = cookieJar(await signUp('me@example.com'))

  // Act
  const user = await rpc(cookie).me()

  // Assert
  expect(user.email).toBe('me@example.com')
  expect(user.name).toBe('Raphtalia')
})

test('an anonymous call to an authed procedure is rejected with UNAUTHORIZED', async () => {
  // Act + Assert
  await expect(rpc().me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
})

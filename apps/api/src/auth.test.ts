import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { expect, test } from 'vitest'

import { app } from './app'
import type { AppRouter } from './rpc/router'

const signUp = async (email: string) =>
  app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Raphtalia',
      email,
      password: 'correct horse battery staple',
    }),
  })

// What a browser would send back: every Set-Cookie pair, attributes stripped.
const cookieJar = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

const rpc = (cookie = '') =>
  createORPCClient<RouterClient<AppRouter>>(
    new RPCLink({
      url: 'http://localhost/api/rpc',
      headers: { cookie },
      fetch: async (request) => app.request(request),
    }),
  )

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

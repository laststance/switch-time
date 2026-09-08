import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { expect, test } from 'vitest'

import { app } from './app'
import type { AppRouter } from './rpc/router'

// In-process client: RPCLink hands each Request straight to Hono, so the `/api/rpc` mount is exercised without a socket.
const client: RouterClient<AppRouter> = createORPCClient(
  new RPCLink({
    url: 'http://localhost/api/rpc',
    fetch: async (request) => app.request(request),
  }),
)

test('GET /api/healthz responds 200 with status ok', async () => {
  // Act
  const response = await app.request('/api/healthz')

  // Assert
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ status: 'ok' })
})

test('ping procedure returns ok and an ISO timestamp', async () => {
  // Act
  const result = await client.ping()

  // Assert
  expect(result.ok).toBe(true)
  expect(new Date(result.now).toISOString()).toBe(result.now)
})

test('a request body over 100 KB is rejected with 413 before any handler sees it', async () => {
  // Arrange
  const body = JSON.stringify({
    name: 'x'.repeat(101 * 1024),
    email: 'big@example.com',
    password: 'correct horse battery staple',
  })

  // Act
  const response = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })

  // Assert
  expect(response.status).toBe(413)
})

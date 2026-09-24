import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import { DAY_ROWS_MAX } from '@switch-time/shared'
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

test('API responses opt out of CDN caching, Better Auth routes included', async () => {
  // Act
  const healthz = await app.request('/api/healthz')
  const authOk = await app.request('/api/auth/ok')

  // Assert
  expect(healthz.headers.get('cache-control')).toBe('no-store')
  expect(authOk.status).toBe(200)
  expect(authOk.headers.get('cache-control')).toBe('no-store')
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

test('the largest 元に戻す the correction sheet can send stays under the body limit and reaches the procedure', async () => {
  // Arrange: a split on the busiest listed day leaves DAY_ROWS_MAX + 1 rows, and its undo writes back DAY_ROWS_MAX.
  const start = Date.parse('2026-09-24T15:00:00.000Z')
  const minute = 60_000
  const expected = Array.from({ length: DAY_ROWS_MAX + 1 }, (_, index) => ({
    id: crypto.randomUUID(),
    activityId: crypto.randomUUID(),
    startedAt: new Date(start + index * minute),
  }))
  const rows = Array.from({ length: DAY_ROWS_MAX }, (_, index) => ({
    activityId: crypto.randomUUID(),
    startedAt: new Date(start + index * minute),
  }))

  // Act: signed out, so a request that got past the body limit stops at the session check.
  const undo = client.switches.replaceDay({
    day: '2026-09-25',
    timeZone: 'America/Argentina/ComodRivadavia',
    expected,
    carriedOutId: crypto.randomUUID(),
    rows,
  })

  // Assert
  await expect(undo).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
})

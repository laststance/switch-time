import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'

import { cachedEmailVerification, loadEmailVerification } from './auth-config'

const ORIGIN = 'http://api.example'

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

afterEach(() => {
  vi.unstubAllGlobals()
})

test('sign-up learns that the API confirms by mail before it sends, and reads the same answer afterwards', async () => {
  // Arrange
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ emailVerification: true }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const client = newClient()

  // Act
  const loaded = await loadEmailVerification(client, ORIGIN)

  // Assert
  expect(loaded).toBe(true)
  expect(cachedEmailVerification(client)).toBe(true)
  expect(fetchMock).toHaveBeenCalledWith('http://api.example/api/auth-config')
})

test('an API that cannot be reached counts as no mail, so sign-up is not held up and shows the plain notice', async () => {
  // Arrange
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}, { status: 500 })),
  )
  const client = newClient()

  // Act
  const loaded = await loadEmailVerification(client, ORIGIN)

  // Assert
  expect(loaded).toBe(false)
  expect(cachedEmailVerification(client)).toBe(false)
})

test('the answer is asked once per session: a second sign-up does not ask again', async () => {
  // Arrange
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ emailVerification: false }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const client = newClient()
  await loadEmailVerification(client, ORIGIN)

  // Act
  await loadEmailVerification(client, ORIGIN)

  // Assert
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('before any answer the cache says no mail', () => {
  // Act
  const cached = cachedEmailVerification(newClient())

  // Assert
  expect(cached).toBe(false)
})

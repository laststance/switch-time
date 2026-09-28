import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'

import { invalidateKeys } from './query'

// query.ts wires AppState to focus on native only; on 'web' it never reaches for it.
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn() },
  Platform: { OS: 'web' },
}))

const STATS_KEY = ['stats', 'week']

// A read the test answers by hand, so it can land after the tap it predates.
function deferredRead() {
  let answer: (value: string) => void = () => {}
  const promise = new Promise<string>((resolve) => {
    answer = resolve
  })
  return { promise, answer }
}

let client: QueryClient
afterEach(() => {
  client.clear()
})

test('a tap stored during the first stats load shows in the stats that load ends with', async () => {
  // Arrange: 記録 is open and its first read of the stats is still out when the tap is stored.
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const olderRead = deferredRead()
  const newerRead = deferredRead()
  const queryFn = vi
    .fn<() => Promise<string>>()
    .mockReturnValueOnce(olderRead.promise)
    .mockReturnValueOnce(newerRead.promise)
  const screen = new QueryObserver(client, { queryKey: STATS_KEY, queryFn })
  const shown: { status: string; data: string | undefined }[] = []
  const unsubscribe = screen.subscribe((result) => {
    shown.push({ status: result.status, data: result.data })
  })

  // Act: the tap's onSettled invalidates the stats, then both reads answer, the older one last.
  const invalidated = invalidateKeys(client, [['stats']])
  newerRead.answer('stats with the tap')
  olderRead.answer('stats without the tap')
  await invalidated

  // Assert: the screen goes from loading straight to the newer read, never through an error or the older read.
  expect(shown.at(-1)).toEqual({
    status: 'success',
    data: 'stats with the tap',
  })
  expect(shown.map((result) => result.status)).not.toContain('error')
  expect(shown.map((result) => result.data)).not.toContain(
    'stats without the tap',
  )
  expect(queryFn).toHaveBeenCalledTimes(2)
  unsubscribe()
})

test('a tap stored during a refetch of stats already on screen still shows in them', async () => {
  // Arrange: the stats are on screen and a refetch of them is out when the tap is stored.
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(STATS_KEY, 'stats on screen')
  const olderRead = deferredRead()
  const newerRead = deferredRead()
  const queryFn = vi
    .fn<() => Promise<string>>()
    .mockReturnValueOnce(olderRead.promise)
    .mockReturnValueOnce(newerRead.promise)
  const screen = new QueryObserver(client, {
    queryKey: STATS_KEY,
    queryFn,
    staleTime: Infinity,
  })
  const unsubscribe = screen.subscribe(() => {})
  void screen.refetch()

  // Act
  const invalidated = invalidateKeys(client, [['stats']])
  newerRead.answer('stats with the tap')
  olderRead.answer('stats without the tap')
  await invalidated

  // Assert
  expect(client.getQueryData(STATS_KEY)).toBe('stats with the tap')
  expect(queryFn).toHaveBeenCalledTimes(2)
  unsubscribe()
})

test('a first load no screen is watching is left to finish rather than cancelled', async () => {
  // Arrange: a prefetch with no observer, which the invalidation will not refetch.
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onlyRead = deferredRead()
  const queryFn = vi
    .fn<() => Promise<string>>()
    .mockReturnValueOnce(onlyRead.promise)
  const prefetch = client.fetchQuery({ queryKey: STATS_KEY, queryFn })

  // Act
  const invalidated = invalidateKeys(client, [['stats']])
  onlyRead.answer('prefetched stats')
  await invalidated

  // Assert: the prefetch resolves instead of rejecting with a CancelledError it could never recover from.
  await expect(prefetch).resolves.toBe('prefetched stats')
  expect(queryFn).toHaveBeenCalledTimes(1)
})

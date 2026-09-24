import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { RequestTimeoutError, withDeadline } from './deadline'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// A request that answers only once its signal aborts, as fetch does, or never when it ignores the signal.
const hanging =
  (honoursAbort: boolean) =>
  async (signal: AbortSignal): Promise<string> =>
    new Promise((_resolve, reject) => {
      if (honoursAbort)
        signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
    })

test('a request that answers in time gets its answer, and the deadline never fires later', async () => {
  // Arrange
  const answer = withDeadline(undefined, 30_000, async () => 'rows')

  // Act
  const result = await answer
  vi.advanceTimersByTime(60_000)

  // Assert
  expect(result).toBe('rows')
  expect(vi.getTimerCount()).toBe(0)
})

test('a request that never answers fails with a timeout at the deadline and is aborted, so the panel is released', async () => {
  // Arrange
  let seenSignal: AbortSignal | undefined
  const answer = withDeadline(undefined, 30_000, async (signal) => {
    seenSignal = signal
    return hanging(true)(signal)
  })
  const settled = answer.catch((error: unknown) => error)

  // Act
  vi.advanceTimersByTime(29_999)
  const abortedEarly = seenSignal?.aborted
  vi.advanceTimersByTime(1)

  // Assert
  expect(abortedEarly).toBe(false)
  expect(await settled).toBeInstanceOf(RequestTimeoutError)
  expect(seenSignal?.aborted).toBe(true)
})

test('a request that ignores the abort (a body that never finishes) still fails at the deadline', async () => {
  // Arrange
  const settled = withDeadline(undefined, 30_000, hanging(false)).catch(
    (error: unknown) => error,
  )

  // Act
  vi.advanceTimersByTime(30_000)

  // Assert
  expect(await settled).toBeInstanceOf(RequestTimeoutError)
})

test('the caller cancelling aborts the request with the request’s own error, not a timeout', async () => {
  // Arrange
  const caller = new AbortController()
  const settled = withDeadline(caller.signal, 30_000, hanging(true)).catch(
    (error: unknown) => error,
  )

  // Act
  caller.abort()

  // Assert
  const error = await settled
  expect(error).not.toBeInstanceOf(RequestTimeoutError)
  expect(error).toMatchObject({ name: 'AbortError' })
  expect(vi.getTimerCount()).toBe(0)
})

test('a request that fails before the deadline (offline) fails with its own error, not a timeout, and leaves no timer behind', async () => {
  // Arrange
  const offline = new TypeError('Failed to fetch')

  // Act
  const error = await withDeadline(undefined, 30_000, async () => {
    throw offline
  }).catch((reason: unknown) => reason)

  // Assert
  expect(error).toBe(offline)
  expect(vi.getTimerCount()).toBe(0)
})

test('a caller cancelling after the request answered does not abort the request’s signal', async () => {
  // Arrange
  const caller = new AbortController()
  let seenSignal: AbortSignal | undefined
  await withDeadline(caller.signal, 30_000, async (signal) => {
    seenSignal = signal
    return 'rows'
  })

  // Act
  caller.abort()

  // Assert
  expect(seenSignal?.aborted).toBe(false)
})

test('a caller that already gave up hands the request an aborted signal', async () => {
  // Arrange
  const caller = new AbortController()
  caller.abort()
  let startedAborted: boolean | undefined

  // Act
  await withDeadline(caller.signal, 30_000, async (signal) => {
    startedAborted = signal.aborted
    return 'rows'
  })

  // Assert
  expect(startedAborted).toBe(true)
})

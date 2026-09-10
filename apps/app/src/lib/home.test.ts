import { describe, expect, test } from 'vitest'

import { homeFallback } from './home'

describe('homeFallback', () => {
  test('shows the first-launch screen only once the fetch answered with no current state', () => {
    // Arrange
    const answered = { isPending: false, isError: false, hasCurrent: false }

    // Act
    const fallback = homeFallback(answered)

    // Assert
    expect(fallback).toBe('first-launch')
  })

  test('keeps the bare frame while the first answer is in flight, so returning users see no flash', () => {
    // Arrange
    const inFlight = { isPending: true, isError: false, hasCurrent: false }

    // Act
    const fallback = homeFallback(inFlight)

    // Assert
    expect(fallback).toBe('loading')
  })

  test('offers a retry when the fetch failed instead of an empty screen', () => {
    // Arrange
    const failed = { isPending: false, isError: true, hasCurrent: false }

    // Act
    const fallback = homeFallback(failed)

    // Assert
    expect(fallback).toBe('error')
  })

  test('waits rather than claiming first launch when a current state has no activity row yet', () => {
    // Arrange: the switch arrived before the activity list did
    const partial = { isPending: false, isError: false, hasCurrent: true }

    // Act
    const fallback = homeFallback(partial)

    // Assert
    expect(fallback).toBe('loading')
  })
})

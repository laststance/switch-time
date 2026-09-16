import { describe, expect, test } from 'vitest'

import { gridActivities, homeFallback, homeReady, nowLook } from './home'

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

describe('homeReady', () => {
  test('renders the body for detox once the activity list has answered', () => {
    // Arrange: the current switch has no activity, both queries have answered
    const detox = {
      current: { activityId: null },
      activity: null,
      isPending: false,
      isError: false,
    }

    // Act
    const ready = homeReady(detox)

    // Assert
    expect(ready).toBe(true)
  })

  test('waits for the activity list while detox is current', () => {
    // Arrange
    const loading = {
      current: { activityId: null },
      activity: null,
      isPending: true,
      isError: false,
    }

    // Act
    const ready = homeReady(loading)

    // Assert
    expect(ready).toBe(false)
  })

  test('still waits when a current activity has no row yet', () => {
    // Arrange: the switch arrived before the activity list did
    const partial = {
      current: { activityId: 'work' },
      activity: null,
      isPending: false,
      isError: false,
    }

    // Act
    const ready = homeReady(partial)

    // Assert
    expect(ready).toBe(false)
  })
})

describe('nowLook', () => {
  test('names the activity in its own colour and counts today’s switches', () => {
    // Arrange
    const work = { name: '仕事', color: '#3B7BD9' }

    // Act
    const look = nowLook(work, '9:05', 3)

    // Assert
    expect(look).toEqual({
      name: '仕事',
      color: '#3B7BD9',
      subtext: '9:05 から · 今日 3 回切替',
    })
  })

  test('detox has no colour and says nothing accumulates', () => {
    // Act
    const look = nowLook(null, '21:20', 3)

    // Assert
    expect(look).toEqual({
      name: 'detox',
      color: null,
      subtext: '21:20 から · どの行動にも積み上がりません',
    })
  })
})

describe('gridActivities', () => {
  test('keeps an activity archived elsewhere as the last button', () => {
    // Arrange
    const live = [{ id: 'home' }, { id: 'work' }]

    // Act
    const withArchived = gridActivities(live, { id: 'rest' })
    const withLive = gridActivities(live, { id: 'work' })

    // Assert
    expect(withArchived).toEqual([
      { id: 'home' },
      { id: 'work' },
      { id: 'rest' },
    ])
    expect(withLive).toBe(live)
  })

  test('adds no button for detox', () => {
    // Arrange
    const live = [{ id: 'home' }]

    // Act
    const buttons = gridActivities(live, null)

    // Assert
    expect(buttons).toBe(live)
  })
})

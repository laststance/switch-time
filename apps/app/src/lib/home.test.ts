import { describe, expect, test } from 'vitest'

import {
  badgeRing,
  detoxPastWeek,
  detoxStopped,
  gridActivities,
  homeFallback,
  homeReady,
  nowLook,
} from './home'

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
  test('renders the body as soon as the current activity has its row', () => {
    // Arrange: the everyday case, an activity is current and its row came with the list
    const working = {
      current: { activityId: 'work' },
      activity: { id: 'work' },
      activitiesLoaded: true,
    }

    // Act
    const ready = homeReady(working)

    // Assert
    expect(ready).toBe(true)
  })

  test('renders the body for detox once the activity list has answered, and keeps it when a later refetch fails', () => {
    // Arrange: the current switch has no activity and the activity list is here (the hook keeps `activitiesLoaded` true through a
    // failed background refetch, so the same input covers that case)
    const detox = {
      current: { activityId: null },
      activity: null,
      activitiesLoaded: true,
    }

    // Act
    const ready = homeReady(detox)

    // Assert
    expect(ready).toBe(true)
  })

  test('waits for the activity list while detox is current, loading or failed on its first fetch', () => {
    // Arrange: the list has never answered, so there is nothing to draw the switch buttons from
    const loading = {
      current: { activityId: null },
      activity: null,
      activitiesLoaded: false,
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
      activitiesLoaded: false,
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
    const look = nowLook(work, '9:05', 3, false)

    // Assert
    expect(look).toEqual({
      name: '仕事',
      color: '#3B7BD9',
      subtext: '9:05 から · 今日 3 回切替',
      notice: null,
    })
  })

  test('detox has no colour and says nothing accumulates', () => {
    // Act
    const look = nowLook(null, '21:20', 3, false)

    // Assert
    expect(look).toEqual({
      name: 'detox',
      color: null,
      subtext: '21:20 から · どの行動にも積み上がりません',
      notice: null,
    })
  })

  test('a detox past its week says today does not count, the 7-day rule and how to count today', () => {
    // Act
    const look = nowLook(null, '9月16日 21:20', 0, true)

    // Assert: the since line stays; the notice states the rule without an ordinal day
    expect(look).toEqual({
      name: 'detox',
      color: null,
      subtext: '9月16日 21:20 から · どの行動にも積み上がりません',
      notice: {
        title: '今日は計測に入りません',
        body: 'デトックスの計測は始めた翌日から7日間まで。今日中に行動へ切り替えると、今日も計測に入ります。',
      },
    })
  })

  test('an activity never carries the detox notice', () => {
    // Arrange
    const work = { name: '仕事', color: '#3B7BD9' }

    // Act
    const look = nowLook(work, '9月24日 23:10', 0, true)

    // Assert
    expect(look.notice).toBeNull()
  })
})

describe('detoxPastWeek', () => {
  test('asks about today from the eighth day after a detox record started, and not on the seventh', () => {
    // Arrange: a detox from 9/16 21:20 JST, read in Tokyo
    const current = {
      activityId: null,
      startedAt: new Date('2026-09-16T12:20:00Z'),
    }
    const base = { current, timeZone: 'Asia/Tokyo', switchCountToday: 0 }

    // Act
    const seventhDay = detoxPastWeek({ ...base, today: '2026-09-23' })
    const eighthDay = detoxPastWeek({ ...base, today: '2026-09-24' })

    // Assert
    expect(seventhDay).toBe(false)
    expect(eighthDay).toBe(true)
  })

  test('does not ask once today has a tap, or for an activity', () => {
    // Arrange: nine days after a record from 9/16 21:20 JST
    const startedAt = new Date('2026-09-16T12:20:00Z')
    const base = { today: '2026-09-25', timeZone: 'Asia/Tokyo' }

    // Act
    const tappedToday = detoxPastWeek({
      ...base,
      current: { activityId: null, startedAt },
      switchCountToday: 1,
    })
    const activity = detoxPastWeek({
      ...base,
      current: { activityId: 'work', startedAt },
      switchCountToday: 0,
    })

    // Assert
    expect(tappedToday).toBe(false)
    expect(activity).toBe(false)
  })

  test('counts the week from the start day in the stored zone', () => {
    // Arrange: 9/16 23:30 UTC is 9/17 8:30 in Tokyo but 9/16 19:30 in New York
    const current = {
      activityId: null,
      startedAt: new Date('2026-09-16T23:30:00Z'),
    }
    const base = { current, today: '2026-09-24', switchCountToday: 0 }

    // Act
    const tokyo = detoxPastWeek({ ...base, timeZone: 'Asia/Tokyo' })
    const newYork = detoxPastWeek({ ...base, timeZone: 'America/New_York' })

    // Assert
    expect(tokyo).toBe(false)
    expect(newYork).toBe(true)
  })
})

describe('detoxStopped', () => {
  // A detox from 9/16 21:20 JST, read on 9/25 (Tokyo), the server's answer for today and a settled fetch
  const carriedDetox = {
    activityId: null,
    startedAt: new Date('2026-09-16T12:20:00Z'),
  }
  const unmeasuredToday = {
    days: [{ day: '2026-09-25', measured: false, excluded: null }],
  }
  const settled = { isError: false, isPaused: false }

  test('says a detox carried in from an earlier day has stopped counting when the server reads today as unmeasured', () => {
    // Act
    const stopped = detoxStopped({
      current: carriedDetox,
      today: '2026-09-25',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 0,
      stats: { ...settled, data: unmeasuredToday },
    })

    // Assert
    expect(stopped).toBe(true)
  })

  test('stays quiet while the detox is still inside its week (today measured)', () => {
    // Act
    const stopped = detoxStopped({
      current: carriedDetox,
      today: '2026-09-23',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 0,
      stats: {
        ...settled,
        data: { days: [{ day: '2026-09-23', measured: true, excluded: null }] },
      },
    })

    // Assert
    expect(stopped).toBe(false)
  })

  test('stays quiet on a day the user excluded by hand', () => {
    // Act
    const stopped = detoxStopped({
      current: carriedDetox,
      today: '2026-09-25',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 0,
      stats: {
        ...settled,
        data: {
          days: [{ day: '2026-09-25', measured: false, excluded: 'manual' }],
        },
      },
    })

    // Assert
    expect(stopped).toBe(false)
  })

  test('stays quiet for an activity, whatever the answer says', () => {
    // Act
    const stopped = detoxStopped({
      current: { activityId: 'work', startedAt: carriedDetox.startedAt },
      today: '2026-09-25',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 0,
      stats: { ...settled, data: unmeasuredToday },
    })

    // Assert
    expect(stopped).toBe(false)
  })

  test('stays quiet for a detox started today', () => {
    // Act: 9/25 08:00 JST
    const stopped = detoxStopped({
      current: {
        activityId: null,
        startedAt: new Date('2026-09-24T23:00:00Z'),
      },
      today: '2026-09-25',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 0,
      stats: { ...settled, data: unmeasuredToday },
    })

    // Assert
    expect(stopped).toBe(false)
  })

  test('stays quiet once today has a switch of its own, before the stats refetch lands', () => {
    // Act: the day's list already shows the tap; the cached stats answer predates it
    const stopped = detoxStopped({
      current: carriedDetox,
      today: '2026-09-25',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 1,
      stats: { ...settled, data: unmeasuredToday },
    })

    // Assert
    expect(stopped).toBe(false)
  })

  test('stays quiet on the first day of a detox when the server answers for a day still in its future', () => {
    // Act: a detox from 9/24 21:00 JST; the device reached 9/25 before the server did, which classes a future day unmeasured
    const stopped = detoxStopped({
      current: {
        activityId: null,
        startedAt: new Date('2026-09-24T12:00:00Z'),
      },
      today: '2026-09-25',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 0,
      stats: { ...settled, data: unmeasuredToday },
    })

    // Assert
    expect(stopped).toBe(false)
  })

  test('does not repeat a kept answer after a failed refetch', () => {
    // Act
    const stopped = detoxStopped({
      current: carriedDetox,
      today: '2026-09-25',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 0,
      stats: { isError: true, isPaused: false, data: unmeasuredToday },
    })

    // Assert
    expect(stopped).toBe(false)
  })

  test('does not repeat a kept answer while the fetch waits for the network', () => {
    // Act
    const stopped = detoxStopped({
      current: carriedDetox,
      today: '2026-09-25',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 0,
      stats: { isError: false, isPaused: true, data: unmeasuredToday },
    })

    // Assert
    expect(stopped).toBe(false)
  })

  test('waits for an answer about today: none yet, or one for another day', () => {
    // Act
    const loading = detoxStopped({
      current: carriedDetox,
      today: '2026-09-25',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 0,
      stats: { ...settled, data: undefined },
    })
    const yesterdays = detoxStopped({
      current: carriedDetox,
      today: '2026-09-26',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 0,
      stats: { ...settled, data: unmeasuredToday },
    })

    // Assert
    expect(loading).toBe(false)
    expect(yesterdays).toBe(false)
  })

  test('stays quiet when the answer lists no day at all', () => {
    // Act
    const stopped = detoxStopped({
      current: carriedDetox,
      today: '2026-09-25',
      timeZone: 'Asia/Tokyo',
      switchCountToday: 0,
      stats: { ...settled, data: { days: [] } },
    })

    // Assert
    expect(stopped).toBe(false)
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

describe('badgeRing', () => {
  test('rings the rail badge in sub while detox is current', () => {
    // Arrange
    const detox = { activityId: null }

    // Act
    const ring = badgeRing(detox)

    // Assert
    expect(ring).toBe('border-sub')
  })

  test('keeps the line ring before the first switch and under an activity, whose own colour goes on inline', () => {
    // Arrange
    const firstLaunch = null
    const working = { activityId: 'work' }

    // Act
    const rings = [badgeRing(firstLaunch), badgeRing(working)]

    // Assert
    expect(rings).toEqual(['border-line', 'border-line'])
  })
})

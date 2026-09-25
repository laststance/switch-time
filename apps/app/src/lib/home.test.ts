import { describe, expect, test } from 'vitest'

import {
  badgeRing,
  detoxLastDay,
  detoxNotice,
  detoxPastWeek,
  detoxRenewable,
  detoxStopped,
  gridActivities,
  homeFallback,
  homeReady,
  nowLook,
  sendsPick,
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
    const look = nowLook(work, '9:05', 3, null)

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
    const look = nowLook(null, '21:20', 3, null)

    // Assert
    expect(look).toEqual({
      name: 'detox',
      color: null,
      subtext: '21:20 から · どの行動にも積み上がりません',
      notice: null,
    })
  })

  test('on a detox’s last measured day, warns that tomorrow will not count and how to renew it', () => {
    // Act
    const look = nowLook(null, '9月16日 21:20', 0, 'last-day')

    // Assert: the since line stays; the notice states the rule without an ordinal day
    expect(look).toEqual({
      name: 'detox',
      color: null,
      subtext: '9月16日 21:20 から · どの行動にも積み上がりません',
      notice: {
        title: '明日から計測に入りません',
        body: 'デトックスの計測は始めた翌日から7日間まで。明日はデトックスを押し直すと、また7日間計測に入ります。',
      },
    })
  })

  test('a detox past its week says today does not count, the 7-day rule and that a re-tap counts today', () => {
    // Act
    const look = nowLook(null, '9月16日 21:20', 0, 'stopped')

    // Assert: the since line stays; the notice states the rule without an ordinal day
    expect(look).toEqual({
      name: 'detox',
      color: null,
      subtext: '9月16日 21:20 から · どの行動にも積み上がりません',
      notice: {
        title: '今日は計測に入りません',
        body: 'デトックスの計測は始めた翌日から7日間まで。デトックスを押し直すか行動へ切り替えると、今日も計測に入ります。',
      },
    })
  })

  test('an activity never carries a detox notice', () => {
    // Arrange
    const work = { name: '仕事', color: '#3B7BD9' }

    // Act
    const stopped = nowLook(work, '9月24日 23:10', 0, 'stopped')
    const lastDay = nowLook(work, '9月24日 23:10', 0, 'last-day')

    // Assert
    expect(stopped.notice).toBeNull()
    expect(lastDay.notice).toBeNull()
  })
})

describe('detoxPastWeek', () => {
  test('asks about today from the eighth day after a detox run started, and not on the seventh', () => {
    // Arrange: a detox run from 9/16
    const base = {
      current: { activityId: null, runStartDay: '2026-09-16' },
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
    }

    // Act
    const seventhDay = detoxPastWeek({ ...base, today: '2026-09-23' })
    const eighthDay = detoxPastWeek({ ...base, today: '2026-09-24' })

    // Assert
    expect(seventhDay).toBe(false)
    expect(eighthDay).toBe(true)
  })

  test('counts from the run’s start, so a cut that started the running record later does not hide a stopped day', () => {
    // Arrange: the run started 9/16; a cut on 9/20 started the running record, which the run start does not follow
    const cutRun = { activityId: null, runStartDay: '2026-09-16' }

    // Act
    const eighthDay = detoxPastWeek({
      current: cutRun,
      today: '2026-09-24',
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
    })

    // Assert
    expect(eighthDay).toBe(true)
  })

  test('does not ask while auto-exclusion is off, since the server then measures every day', () => {
    // Act: nine days after a detox run from 9/16
    const carried = detoxPastWeek({
      current: { activityId: null, runStartDay: '2026-09-16' },
      today: '2026-09-25',
      switchCountToday: 0,
      autoExcludeUnusedDays: false,
    })

    // Assert
    expect(carried).toBe(false)
  })

  test('does not ask once today has a tap, for an activity, or for the optimistic row a tap writes', () => {
    // Arrange: nine days after a run from 9/16
    const base = { today: '2026-09-25', autoExcludeUnusedDays: true }

    // Act
    const tappedToday = detoxPastWeek({
      ...base,
      current: { activityId: null, runStartDay: '2026-09-16' },
      switchCountToday: 1,
    })
    const activity = detoxPastWeek({
      ...base,
      current: { activityId: 'work', runStartDay: null },
      switchCountToday: 0,
    })
    const optimistic = detoxPastWeek({
      ...base,
      current: { activityId: null, runStartDay: null },
      switchCountToday: 0,
    })

    // Assert
    expect(tappedToday).toBe(false)
    expect(activity).toBe(false)
    expect(optimistic).toBe(false)
  })
})

describe('detoxLastDay', () => {
  test('warns on the seventh day after a detox run started, and on no other day', () => {
    // Arrange: a detox run from 9/16
    const base = {
      current: { activityId: null, runStartDay: '2026-09-16' },
      autoExcludeUnusedDays: true,
    }

    // Act
    const sixthDay = detoxLastDay({ ...base, today: '2026-09-22' })
    const seventhDay = detoxLastDay({ ...base, today: '2026-09-23' })
    const eighthDay = detoxLastDay({ ...base, today: '2026-09-24' })

    // Assert
    expect(sixthDay).toBe(false)
    expect(seventhDay).toBe(true)
    expect(eighthDay).toBe(false)
  })

  test('does not warn while auto-exclusion is off, for an activity, or for the optimistic row a tap writes', () => {
    // Arrange: the seventh day of a run from 9/16
    const today = '2026-09-23'

    // Act
    const autoExcludeOff = detoxLastDay({
      current: { activityId: null, runStartDay: '2026-09-16' },
      today,
      autoExcludeUnusedDays: false,
    })
    const activity = detoxLastDay({
      current: { activityId: 'work', runStartDay: null },
      today,
      autoExcludeUnusedDays: true,
    })
    const optimistic = detoxLastDay({
      current: { activityId: null, runStartDay: null },
      today,
      autoExcludeUnusedDays: true,
    })

    // Assert
    expect(autoExcludeOff).toBe(false)
    expect(activity).toBe(false)
    expect(optimistic).toBe(false)
  })
})

describe('detoxRenewable', () => {
  test('lets a detox press through from the eighth day after its run started, so it starts a new run', () => {
    // Arrange: a detox run from 9/16
    const current = { activityId: null, runStartDay: '2026-09-16' }

    // Act
    const seventhDay = detoxRenewable({ current, today: '2026-09-23' })
    const eighthDay = detoxRenewable({ current, today: '2026-09-24' })

    // Assert
    expect(seventhDay).toBe(false)
    expect(eighthDay).toBe(true)
  })

  test('drops a second press before the refetch, and never renews an activity', () => {
    // Arrange: the optimistic row the first press wrote has no run start yet
    const today = '2026-09-25'

    // Act
    const optimistic = detoxRenewable({
      current: { activityId: null, runStartDay: null },
      today,
    })
    const activity = detoxRenewable({
      current: { activityId: 'work', runStartDay: null },
      today,
    })

    // Assert
    expect(optimistic).toBe(false)
    expect(activity).toBe(false)
  })
})

describe('detoxStopped', () => {
  // A detox run from 9/16, read on 9/25, the server's answer for today and a settled fetch
  const carriedDetox = { activityId: null, runStartDay: '2026-09-16' }
  const unmeasuredToday = {
    days: [{ day: '2026-09-25', measured: false, excluded: null }],
  }
  const settled = { isError: false, isPaused: false }

  test('says a detox carried in from an earlier day has stopped counting when the server reads today as unmeasured', () => {
    // Act
    const stopped = detoxStopped({
      current: carriedDetox,
      today: '2026-09-25',
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
      stats: { ...settled, data: unmeasuredToday },
    })

    // Assert
    expect(stopped).toBe(true)
  })

  test('does not read the answer while the detox is still inside its week', () => {
    // Act
    const stopped = detoxStopped({
      current: carriedDetox,
      today: '2026-09-23',
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
      stats: {
        ...settled,
        data: { days: [{ day: '2026-09-23', measured: true, excluded: null }] },
      },
    })

    // Assert
    expect(stopped).toBe(false)
  })

  test('stays quiet past the week when the server still measures today', () => {
    // Act
    const stopped = detoxStopped({
      current: carriedDetox,
      today: '2026-09-25',
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
      stats: {
        ...settled,
        data: { days: [{ day: '2026-09-25', measured: true, excluded: null }] },
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
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
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
      current: { activityId: 'work', runStartDay: null },
      today: '2026-09-25',
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
      stats: { ...settled, data: unmeasuredToday },
    })

    // Assert
    expect(stopped).toBe(false)
  })

  test('stays quiet for a detox started today', () => {
    // Act
    const stopped = detoxStopped({
      current: { activityId: null, runStartDay: '2026-09-25' },
      today: '2026-09-25',
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
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
      switchCountToday: 1,
      autoExcludeUnusedDays: true,
      stats: { ...settled, data: unmeasuredToday },
    })

    // Assert
    expect(stopped).toBe(false)
  })

  test('stays quiet on the first day of a detox when the server answers for a day still in its future', () => {
    // Act: a detox run from 9/24; the device reached 9/25 before the server did, which classes a future day unmeasured
    const stopped = detoxStopped({
      current: { activityId: null, runStartDay: '2026-09-24' },
      today: '2026-09-25',
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
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
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
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
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
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
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
      stats: { ...settled, data: undefined },
    })
    const yesterdays = detoxStopped({
      current: carriedDetox,
      today: '2026-09-26',
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
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
      switchCountToday: 0,
      autoExcludeUnusedDays: true,
      stats: { ...settled, data: { days: [] } },
    })

    // Assert
    expect(stopped).toBe(false)
  })
})

describe('detoxNotice', () => {
  // A detox run from 9/16, no tap today, auto-exclusion on
  const base = {
    current: { activityId: null, runStartDay: '2026-09-16' },
    switchCountToday: 0,
    autoExcludeUnusedDays: true,
  }
  const settled = { isError: false, isPaused: false }

  test('warns on the last day, before any server answer is needed', () => {
    // Act
    const notice = detoxNotice({
      ...base,
      today: '2026-09-23',
      stats: { ...settled, data: undefined },
    })

    // Assert
    expect(notice).toBe('last-day')
  })

  test('says a day past the week is stopped once the server reads it as unmeasured', () => {
    // Act
    const notice = detoxNotice({
      ...base,
      today: '2026-09-25',
      stats: {
        ...settled,
        data: {
          days: [{ day: '2026-09-25', measured: false, excluded: null }],
        },
      },
    })

    // Assert
    expect(notice).toBe('stopped')
  })

  test('shows nothing past the week while the answer is unknown, or inside the week before its last day', () => {
    // Act
    const unknown = detoxNotice({
      ...base,
      today: '2026-09-25',
      stats: { ...settled, data: undefined },
    })
    const sixthDay = detoxNotice({
      ...base,
      today: '2026-09-22',
      stats: { ...settled, data: undefined },
    })

    // Assert
    expect(unknown).toBeNull()
    expect(sixthDay).toBeNull()
  })
})

describe('sendsPick', () => {
  test('sends a press on another state, whatever the detox run says', () => {
    // Act
    const toActivity = sendsPick({
      activityId: 'work',
      current: { activityId: null },
      renewable: false,
    })
    const toDetox = sendsPick({
      activityId: null,
      current: { activityId: 'work' },
      renewable: false,
    })

    // Assert
    expect(toActivity).toBe(true)
    expect(toDetox).toBe(true)
  })

  test('drops a press on the current state, except detox past its run’s week', () => {
    // Act
    const sameActivity = sendsPick({
      activityId: 'work',
      current: { activityId: 'work' },
      renewable: false,
    })
    const detoxInsideWeek = sendsPick({
      activityId: null,
      current: { activityId: null },
      renewable: false,
    })
    const renewedDetox = sendsPick({
      activityId: null,
      current: { activityId: null },
      renewable: true,
    })

    // Assert
    expect(sameActivity).toBe(false)
    expect(detoxInsideWeek).toBe(false)
    expect(renewedDetox).toBe(true)
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

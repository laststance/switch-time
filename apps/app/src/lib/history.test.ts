import { expect, test } from 'vitest'

import {
  historyView,
  shiftMonth,
  sliceLook,
  weekStart,
  type HistoryActivity,
  type HistoryStats,
} from './history'

const H = 3_600_000

const activity = (
  overrides: Partial<HistoryActivity> & Pick<HistoryActivity, 'id' | 'name'>,
): HistoryActivity => ({
  color: '#3B7BD9',
  iconKey: 'work',
  targetHours: 8,
  archivedAt: null,
  ...overrides,
})

const day = (
  date: string,
  overrides: Partial<HistoryStats['days'][number]> = {},
): HistoryStats['days'][number] => ({
  day: date,
  measured: false,
  excluded: null,
  totals: {},
  idleMs: 0,
  detoxMs: 0,
  ...overrides,
})

// The e2e fixture in numbers: first tap on 9/6, nothing on 9/7, taps on 9/8 and today (9/9).
const week: HistoryStats = {
  days: [
    day('2026-09-03'),
    day('2026-09-04'),
    day('2026-09-05'),
    day('2026-09-06', {
      measured: true,
      totals: { work: 8 * H },
      idleMs: 6 * H,
    }),
    day('2026-09-07', { excluded: 'auto_unused', idleMs: 24 * H }),
    day('2026-09-08', { measured: true, totals: { work: 10 * H, old: 3 * H } }),
    day('2026-09-09', { measured: true }),
  ],
  totals: { work: 18 * H, old: 3 * H },
  measuredDays: 3,
  streak: 2,
  excludedDays: [{ day: '2026-09-07', reason: 'auto_unused' }],
}

const activities = [
  activity({ id: 'work', name: '仕事' }),
  activity({
    id: 'home',
    name: '家事',
    color: '#E0A431',
    iconKey: 'home',
    targetHours: 1.5,
  }),
  activity({
    id: 'old',
    name: '旧',
    color: '#D8579C',
    iconKey: 'fun',
    targetHours: null,
    archivedAt: new Date('2026-09-01T00:00:00Z'),
  }),
  activity({
    id: 'gone',
    name: '消',
    archivedAt: new Date('2026-09-01T00:00:00Z'),
  }),
]

test('the week chart stacks measured days, dashes the unused day and keeps the average over measured days', () => {
  // Arrange
  const today = '2026-09-09'

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today,
    stats: week,
    activities,
  })

  // Assert
  expect(view.title).toBe('直近7日')
  expect(view.barHeight).toBe(132)
  expect(view.detoxGlyphSize).toBe(14)
  expect(view.weekdays).toEqual([])
  expect(view.rows).toHaveLength(1)
  expect(
    view.rows[0]?.map((cell) => [cell?.label, cell?.kind, cell?.ariaLabel]),
  ).toEqual([
    ['木', 'empty', '9月3日（木）'],
    ['金', 'empty', '9月4日（金）'],
    ['土', 'empty', '9月5日（土）'],
    ['日', 'stack', '9月6日（日）・仕事 8h 00m'],
    ['月', 'excluded', '9月7日（月）・平均から除外'],
    ['火', 'stack', '9月8日（火）・仕事 10h 00m・旧 3h 00m'],
    ['今日', 'stack', '9月9日（水）'],
  ])
  expect(view.rows[0]?.[5]?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 55,
      top: false,
      bottom: true,
    },
    {
      activityId: 'old',
      color: '#D8579C',
      height: 16.5,
      top: true,
      bottom: false,
    },
  ])
  expect(view.rows[0]?.[6]?.today).toBe(true)
  expect(view.measured).toBe('3 / 7日')
  expect(view.streak).toBe('2日')
  expect(view.unusedDays).toBe(1)
  expect(view.breakdown).toEqual([
    {
      id: 'work',
      name: '仕事',
      color: '#3B7BD9',
      iconKey: 'work',
      total: '18h 00m',
      average: '6h 00m',
      ratio: 0.75,
    },
    {
      id: 'home',
      name: '家事',
      color: '#E0A431',
      iconKey: 'home',
      total: '0m',
      average: '0m',
      ratio: 0,
    },
    {
      id: 'old',
      name: '旧',
      color: '#D8579C',
      iconKey: 'fun',
      total: '3h 00m',
      average: '1h 00m',
      ratio: 0,
    },
  ])
})

test('a day whose time all went to detox is outlined and named, instead of looking untapped', () => {
  // Arrange: 9/7 was a whole day of detox, 9/8 mixed 仕事 with detox, today has only its carried-in detox so far
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06', { measured: true, totals: { work: 8 * H } }),
      day('2026-09-07', { measured: true, detoxMs: 24 * H }),
      day('2026-09-08', {
        measured: true,
        totals: { work: 10 * H },
        detoxMs: 3 * H,
      }),
      day('2026-09-09', { measured: true, detoxMs: 9 * H }),
    ],
    totals: { work: 18 * H },
    measuredDays: 4,
    streak: 4,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: only the days with nothing but detox are outlined; a day that also stacked an activity stays a stack
  expect(view.rows[0]?.map((cell) => [cell?.kind, cell?.ariaLabel])).toEqual([
    ['empty', '9月3日（木）'],
    ['empty', '9月4日（金）'],
    ['empty', '9月5日（土）'],
    ['stack', '9月6日（日）・仕事 8h 00m'],
    ['detox', '9月7日（月）・detox の日 24h 00m'],
    ['stack', '9月8日（火）・仕事 10h 00m・detox 3h 00m'],
    ['detox', '9月9日（水）・detox の日 9h 00m'],
  ])
  expect(view.rows[0]?.[4]?.slices).toEqual([])
})

test('a day of mostly idle-flagged time and some detox is a plain day with its detox part drawn, not a detox day', () => {
  // Arrange: 9/9 had 13 h of 仕事 flagged idle (so nothing in totals) and 11 h of detox
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', { measured: true, idleMs: 13 * H, detoxMs: 11 * H }),
    ],
    totals: {},
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: the day is not claimed as a whole day of detox; its 11 h of detox is one outlined slice on the floor
  expect(view.rows[0]?.[6]?.kind).toBe('stack')
  expect(view.rows[0]?.[6]?.ariaLabel).toBe('9月9日（水）・detox 11h 00m')
  expect(view.rows[0]?.[6]?.slices).toEqual([
    { activityId: null, color: null, height: 60.5, top: true, bottom: true },
  ])
})

test('a day with no activity time and as much detox as idle time is outlined as a detox day', () => {
  // Arrange: 9/9 had 12 h flagged idle and 12 h of detox
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', { measured: true, idleMs: 12 * H, detoxMs: 12 * H }),
    ],
    totals: {},
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: the outline is the detox mark, so the cell draws no detox slice inside it
  expect(view.rows[0]?.[6]?.kind).toBe('detox')
  expect(view.rows[0]?.[6]?.ariaLabel).toBe('9月9日（水）・detox の日 12h 00m')
  expect(view.rows[0]?.[6]?.slices).toEqual([])
})

test('a day worked then spent in detox draws the detox part as an outline on top of the work', () => {
  // Arrange: 9/9 had 12 h of 仕事 and 6 h of detox
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        measured: true,
        totals: { work: 12 * H },
        detoxMs: 6 * H,
      }),
    ],
    totals: { work: 12 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: the top corners move from 仕事 to the detox part
  expect(view.rows[0]?.[6]?.kind).toBe('stack')
  expect(view.rows[0]?.[6]?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 66,
      top: false,
      bottom: true,
    },
    { activityId: null, color: null, height: 33, top: true, bottom: false },
  ])
})

test('the detox part is drawn as a sub outline with no fill, and each end of the stack follows the track corners', () => {
  // Arrange: a lone activity slice fills both ends; a detox slice sits on top of another slice
  const lone = {
    activityId: 'work',
    color: '#3B7BD9',
    height: 66,
    top: true,
    bottom: true,
  }
  const detoxOnTop = {
    activityId: null,
    color: null,
    height: 33,
    top: true,
    bottom: false,
  }

  // Act
  const loneLook = sliceLook(lone)
  const detoxLook = sliceLook(detoxOnTop)

  // Assert
  expect(loneLook).toEqual({
    className: 'rounded-t-md rounded-b-md',
    backgroundColor: '#3B7BD9',
  })
  expect(detoxLook).toEqual({
    className: 'rounded-t-md border-sub border',
    backgroundColor: 'transparent',
  })
})

test('a slice between two others is drawn square, and the floor slice rounds only its bottom corners', () => {
  // Arrange: 仕事 on the floor, 家事 in the middle of a stack that detox tops
  const floor = {
    activityId: 'work',
    color: '#3B7BD9',
    height: 44,
    top: false,
    bottom: true,
  }
  const middle = {
    activityId: 'home',
    color: '#E0A431',
    height: 22,
    top: false,
    bottom: false,
  }

  // Act
  const floorLook = sliceLook(floor)
  const middleLook = sliceLook(middle)

  // Assert
  expect(floorLook).toEqual({
    className: 'rounded-b-md',
    backgroundColor: '#3B7BD9',
  })
  expect(middleLook).toEqual({
    className: '',
    backgroundColor: '#E0A431',
  })
})

test('a detox part alone on the track is outlined with all four corners rounded, so the track does not clip its outline', () => {
  // Arrange: an idle-heavy day whose only drawn slice is its detox part
  const detoxAlone = {
    activityId: null,
    color: null,
    height: 60.5,
    top: true,
    bottom: true,
  }

  // Act
  const look = sliceLook(detoxAlone)

  // Assert
  expect(look).toEqual({
    className: 'rounded-t-md rounded-b-md border-sub border',
    backgroundColor: 'transparent',
  })
})

test('a few minutes of detox draw no stray line in the short month cells', () => {
  // Arrange: 9/9 had 8 h of 仕事 and 30 min of detox; a month cell is 48 px, so 30 min is 1 px
  const stats: HistoryStats = {
    days: [
      day('2026-09-09', {
        measured: true,
        totals: { work: 8 * H },
        detoxMs: 0.5 * H,
      }),
    ],
    totals: { work: 8 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'month',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: only the 仕事 slice, which keeps both rounded ends
  expect(view.rows.flat().find((cell) => cell?.today)?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 16,
      top: true,
      bottom: true,
    },
  ])
})

test('an excluded day still draws its detox part, stacked inside the dashed border', () => {
  // Arrange: 9/9 was excluded by hand after 6 h of 仕事 and 3 h of detox
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        excluded: 'manual',
        totals: { work: 6 * H },
        detoxMs: 3 * H,
      }),
    ],
    totals: {},
    measuredDays: 0,
    streak: 0,
    excludedDays: [{ day: '2026-09-09', reason: 'manual' }],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: the 132 px track keeps 130 px inside its 1 px border
  expect(view.rows[0]?.[6]?.kind).toBe('excluded')
  expect(view.rows[0]?.[6]?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 32.5,
      top: false,
      bottom: true,
    },
    { activityId: null, color: null, height: 16.25, top: true, bottom: false },
  ])
})

test('a whole excluded day fits inside its dashed border, so the top of its detox outline is not clipped', () => {
  // Arrange: 9/9 was excluded by hand after 18 h of 仕事 and 6 h of detox, the whole day
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        excluded: 'manual',
        totals: { work: 18 * H },
        detoxMs: 6 * H,
      }),
    ],
    totals: {},
    measuredDays: 0,
    streak: 0,
    excludedDays: [{ day: '2026-09-09', reason: 'manual' }],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: 97.5 + 32.5 = the 130 px inside the border, not the 132 px track
  expect(view.rows[0]?.[6]?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 97.5,
      top: false,
      bottom: true,
    },
    { activityId: null, color: null, height: 32.5, top: true, bottom: false },
  ])
})

test('the detox part of a 25-hour fall-back day stays inside the 24-hour bar', () => {
  // Arrange: the fall-back day had 20 h of 仕事 and 5 h of detox, 25 h on a 24-h track
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        measured: true,
        totals: { work: 20 * H },
        detoxMs: 5 * H,
      }),
    ],
    totals: { work: 20 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: 仕事 takes 110 px of the 132 px track, so the detox part gets the 22 px left rather than 27.5 px
  expect(view.rows[0]?.[6]?.slices?.map((slice) => slice.height)).toEqual([
    110, 22,
  ])
})

test('a fall-back day whose activities fill the whole 24-hour bar draws no detox part above them', () => {
  // Arrange: the fall-back day had 24 h of 仕事 and 1 h of detox, so 仕事 alone fills the 132 px track
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        measured: true,
        totals: { work: 24 * H },
        detoxMs: 1 * H,
      }),
    ],
    totals: { work: 24 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: 仕事 keeps both rounded ends and nothing overflows the track
  expect(view.rows[0]?.[6]?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 132,
      top: true,
      bottom: true,
    },
  ])
})

test('a 25-hour fall-back day cuts its top activity at the end of the 24-hour bar, while its label reads the full times', () => {
  // Arrange: the fall-back day had 12 h of 仕事, 12 h 30 m of 家事 and 30 m of 旧, 25 h on a 24-h track
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        measured: true,
        totals: { work: 12 * H, home: 12.5 * H, old: 0.5 * H },
      }),
    ],
    totals: { work: 12 * H, home: 12.5 * H, old: 0.5 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: 仕事 takes 66 px, 家事 gets the 66 px left instead of 68.75 px, and 旧 has no room, so the stack is exactly 132 px
  expect(view.rows[0]?.[6]?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 66,
      top: false,
      bottom: true,
    },
    {
      activityId: 'home',
      color: '#E0A431',
      height: 66,
      top: true,
      bottom: false,
    },
  ])
  expect(view.rows[0]?.[6]?.ariaLabel).toBe(
    '9月9日（水）・仕事 12h 00m・家事 12h 30m・旧 30m',
  )
})

test('an excluded day that still holds time reads 平均から除外, then each activity and its detox', () => {
  // Arrange: 9/9 was excluded by hand after 6 h of 仕事 and 2 h of detox
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        excluded: 'manual',
        totals: { work: 6 * H },
        detoxMs: 2 * H,
      }),
    ],
    totals: {},
    measuredDays: 0,
    streak: 0,
    excludedDays: [{ day: '2026-09-09', reason: 'manual' }],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert
  expect(view.rows[0]?.[6]?.kind).toBe('excluded')
  expect(view.rows[0]?.[6]?.ariaLabel).toBe(
    '9月9日（水）・平均から除外・仕事 6h 00m・detox 2h 00m',
  )
})

test('an excluded fall-back day whose lower activities fill the bar exactly keeps the rounded top on its last drawn slice', () => {
  // Arrange: on the excluded 25-h day 2 h of 仕事 and 22 h of 家事 fill the 130 px inside the border, then 1 h of 旧 has no room;
  // 130 - 10.83 - 119.17 leaves a 1e-14 px float residue rather than 0
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        excluded: 'manual',
        totals: { work: 2 * H, home: 22 * H, old: 1 * H },
      }),
    ],
    totals: {},
    measuredDays: 0,
    streak: 0,
    excludedDays: [{ day: '2026-09-09', reason: 'manual' }],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: 旧 draws no invisible sliver, so 家事 stays the top slice with the rounded corners
  expect(
    view.rows[0]?.[6]?.slices.map((slice) => [slice.activityId, slice.top]),
  ).toEqual([
    ['work', false],
    ['home', true],
  ])
})

test('an outlined detox day with under half a minute of detox is still named a detox day', () => {
  // Arrange: today (9/9) just after midnight, 10 seconds of detox carried in from yesterday and nothing else
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', { measured: true, detoxMs: 10_000 }),
    ],
    totals: {},
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: the cell draws the detox outline, so its label says detox even without a time to read
  expect(view.rows[0]?.[6]?.kind).toBe('detox')
  expect(view.rows[0]?.[6]?.ariaLabel).toBe('9月9日（水）・detox の日')
})

test('a day cell does not read out times under half a minute as 0m', () => {
  // Arrange: 9/9 had 3 h of 仕事, a 20-second 家事 tap and 29 seconds of detox
  const stats: HistoryStats = {
    days: [
      day('2026-09-09', {
        measured: true,
        totals: { work: 3 * H, home: 20_000 },
        detoxMs: 29_000,
      }),
    ],
    totals: { work: 3 * H, home: 20_000 },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'month',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: the month cell reads in the same format as the week's, and the tap too short to see leaves 仕事 its rounded top
  const cell = view.rows.flat().find((c) => c?.day === '2026-09-09')
  expect(cell?.ariaLabel).toBe('9月9日（水）・仕事 3h 00m')
  expect(cell?.slices.map((slice) => [slice.activityId, slice.top])).toEqual([
    ['work', true],
    ['home', false],
  ])
})

test('short activities in a month cell still stack up rather than leave the track empty', () => {
  // Arrange: 9/9 had 10 minutes each of 仕事, 家事 and 旧, each under half a pixel of the 48 px cell
  const stats: HistoryStats = {
    days: [
      day('2026-09-09', {
        measured: true,
        totals: { work: H / 6, home: H / 6, old: H / 6 },
      }),
    ],
    totals: { work: H / 6, home: H / 6, old: H / 6 },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'month',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: all three are drawn, 1 px together; 家事 holds both outer half pixels, so it takes both rounded ends
  const cell = view.rows.flat().find((c) => c?.day === '2026-09-09')
  expect(
    cell?.slices.map((slice) => [slice.activityId, slice.bottom, slice.top]),
  ).toEqual([
    ['work', false, false],
    ['home', true, true],
    ['old', false, false],
  ])
  expect(
    cell?.slices.reduce((total, slice) => total + slice.height, 0),
  ).toBeCloseTo(1)
})

test('thin slices stacked on a long activity take the rounded top once they add up to half a pixel', () => {
  // Arrange: 9/9 had 8 h of 仕事 (16 px of the 48 px cell), then 10 minutes each of 家事 and 旧 (1/3 px each) on top
  const stats: HistoryStats = {
    days: [
      day('2026-09-09', {
        measured: true,
        totals: { work: 8 * H, home: H / 6, old: H / 6 },
      }),
    ],
    totals: { work: 8 * H, home: H / 6, old: H / 6 },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'month',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: the top half pixel is 旧 and part of 家事, so 家事 takes the rounded top; 仕事 keeps the floor
  const cell = view.rows.flat().find((c) => c?.day === '2026-09-09')
  expect(
    cell?.slices.map((slice) => [slice.activityId, slice.bottom, slice.top]),
  ).toEqual([
    ['work', true, false],
    ['home', false, true],
    ['old', false, false],
  ])
})

test('a negative or NaN activity total is neither drawn nor read, and does not break the slices above it', () => {
  // Arrange: 9/9 carries a broken 仕事 total (NaN) and 家事 total (-1 h) under 3 h of 旧
  const stats: HistoryStats = {
    days: [
      day('2026-09-09', {
        measured: true,
        totals: { work: Number.NaN, home: -H, old: 3 * H },
      }),
    ],
    totals: { work: Number.NaN, home: -H, old: 3 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: only 旧 is drawn (3/24 of the 132 px week column) and read
  const cell = view.rows.flat().find((c) => c?.day === '2026-09-09')
  expect(cell?.slices).toEqual([
    {
      activityId: 'old',
      color: '#D8579C',
      height: 16.5,
      top: true,
      bottom: true,
    },
  ])
  expect(cell?.ariaLabel).toBe('9月9日（水）・旧 3h 00m')
})

test('half an hour of detox too short to outline in a month cell is still read out', () => {
  // Arrange: 9/9 had 8 h of 仕事 and 30 m of detox; in a 48 px month cell 30 m is 1 px, under the 2 px floor
  const stats: HistoryStats = {
    days: [
      day('2026-09-09', {
        measured: true,
        totals: { work: 8 * H },
        detoxMs: 0.5 * H,
      }),
    ],
    totals: { work: 8 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'month',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: only 仕事 is drawn, but the label carries the detox time the outline could not show
  const cell = view.rows.flat().find((c) => c?.today)
  expect(cell?.slices.map((slice) => slice.activityId)).toEqual(['work'])
  expect(cell?.ariaLabel).toBe('9月9日（水）・仕事 8h 00m・detox 30m')
})

test('an hour of detox in a month cell is just tall enough to draw its outline', () => {
  // Arrange: 9/9 had 8 h of 仕事 and 1 h of detox; a month cell is 48 px, so 1 h is exactly the 2 px floor
  const stats: HistoryStats = {
    days: [
      day('2026-09-09', {
        measured: true,
        totals: { work: 8 * H },
        detoxMs: 1 * H,
      }),
    ],
    totals: { work: 8 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'month',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert
  expect(view.rows.flat().find((cell) => cell?.today)?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 16,
      top: false,
      bottom: true,
    },
    { activityId: null, color: null, height: 2, top: true, bottom: false },
  ])
})

test('a day of two activities and detox rounds only the floor and the top, leaving the middle slice square', () => {
  // Arrange: 9/9 had 8 h of 仕事, 4 h of 家事 and 6 h of detox
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        measured: true,
        totals: { work: 8 * H, home: 4 * H },
        detoxMs: 6 * H,
      }),
    ],
    totals: { work: 8 * H, home: 4 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert
  expect(view.rows[0]?.[6]?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 44,
      top: false,
      bottom: true,
    },
    {
      activityId: 'home',
      color: '#E0A431',
      height: 22,
      top: false,
      bottom: false,
    },
    { activityId: null, color: null, height: 33, top: true, bottom: false },
  ])
})

test('today with no taps and no detox yet stays a plain day, not a detox day', () => {
  // Arrange: today (9/9) has nothing recorded
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09'),
    ],
    totals: {},
    measuredDays: 0,
    streak: 0,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert
  expect(view.rows[0]?.[6]?.kind).toBe('stack')
  expect(view.rows[0]?.[6]?.slices).toEqual([])
})

test('状態別 ends with a detox row summed over the measured days only', () => {
  // Arrange: 2 measured days with 2 h and 4 h of detox, and an excluded day with 5 h that must not count
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07', {
        excluded: 'manual',
        detoxMs: 5 * H,
      }),
      day('2026-09-08', {
        measured: true,
        totals: { work: 8 * H },
        detoxMs: 2 * H,
      }),
      day('2026-09-09', {
        measured: true,
        totals: { work: 4 * H },
        detoxMs: 4 * H,
      }),
    ],
    totals: { work: 12 * H },
    measuredDays: 2,
    streak: 2,
    excludedDays: [{ day: '2026-09-07', reason: 'manual' }],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: the detox row has no target, so its bar stays empty
  expect(view.breakdown.at(-1)).toEqual({
    id: 'detox',
    name: 'detox',
    color: null,
    iconKey: 'wind',
    total: '6h 00m',
    average: '3h 00m',
    ratio: 0,
  })
})

test('状態別 lists no detox row for a range without detox time', () => {
  // Arrange: the e2e week has no detox

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats: week,
    activities,
  })

  // Assert
  expect(view.breakdown.map((row) => row.id)).toEqual(['work', 'home', 'old'])
})

test('a day worked on an activity the list does not know yet stays a stack, not a detox day', () => {
  // Arrange: 9/9 had 6 h on an activity made on another device (not in the cached list yet) and 2 h of detox
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        measured: true,
        totals: { made_elsewhere: 6 * H },
        detoxMs: 2 * H,
      }),
    ],
    totals: { made_elsewhere: 6 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: the unknown activity draws no slice and is not read out, and the day is not claimed as detox, so only its 2 h detox
  // part sits on the floor and in the label
  expect(view.rows[0]?.[6]?.kind).toBe('stack')
  expect(view.rows[0]?.[6]?.ariaLabel).toBe('9月9日（水）・detox 2h 00m')
  expect(view.rows[0]?.[6]?.slices).toEqual([
    { activityId: null, color: null, height: 11, top: true, bottom: true },
  ])
})

test('a day cell reads half a minute of time as 1m, the first time that formats as more than 0m', () => {
  // Arrange: 9/9 had 3 h of 仕事, a 30-second 家事 tap and 30 seconds of detox
  const stats: HistoryStats = {
    days: [
      day('2026-09-09', {
        measured: true,
        totals: { work: 3 * H, home: 30_000 },
        detoxMs: 30_000,
      }),
    ],
    totals: { work: 3 * H, home: 30_000 },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'month',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert
  const cell = view.rows.flat().find((c) => c?.day === '2026-09-09')
  expect(cell?.ariaLabel).toBe('9月9日（水）・仕事 3h 00m・家事 1m・detox 1m')
})

test('a day cell reads its activities bottom-up in list order, whatever order the server sent the totals in', () => {
  // Arrange: the totals arrive 旧, 家事, 仕事, the reverse of the list
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        measured: true,
        totals: { old: 1 * H, home: 2 * H, work: 3 * H },
      }),
    ],
    totals: { old: 1 * H, home: 2 * H, work: 3 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: the label and the slices share the list order
  expect(view.rows[0]?.[6]?.ariaLabel).toBe(
    '9月9日（水）・仕事 3h 00m・家事 2h 00m・旧 1h 00m',
  )
  expect(view.rows[0]?.[6]?.slices.map((slice) => slice.activityId)).toEqual([
    'work',
    'home',
    'old',
  ])
})

test('a 25-hour fall-back day whose cut activities fill the bar draws no detox part, but still reads its detox time', () => {
  // Arrange: the fall-back day had 12 h of 仕事, 13 h of 家事 and 1 h of detox
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        measured: true,
        totals: { work: 12 * H, home: 13 * H },
        detoxMs: 1 * H,
      }),
    ],
    totals: { work: 12 * H, home: 13 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: 家事 is cut to the 66 px left and keeps the top corners, since detox has no room above it
  expect(view.rows[0]?.[6]?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 66,
      top: false,
      bottom: true,
    },
    {
      activityId: 'home',
      color: '#E0A431',
      height: 66,
      top: true,
      bottom: false,
    },
  ])
  expect(view.rows[0]?.[6]?.ariaLabel).toBe(
    '9月9日（水）・仕事 12h 00m・家事 13h 00m・detox 1h 00m',
  )
})

test('a fall-back day with under 2 px of the bar left above its activities draws no sliver of detox outline', () => {
  // Arrange: 23 h 45 m of 仕事 takes 130.625 px of the 132 px track, leaving 1.375 px for 1 h of detox
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', {
        measured: true,
        totals: { work: 23.75 * H },
        detoxMs: 1 * H,
      }),
    ],
    totals: { work: 23.75 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: 仕事 alone, with both rounded ends
  expect(view.rows[0]?.[6]?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 130.625,
      top: true,
      bottom: true,
    },
  ])
})

test('an excluded 25-hour fall-back day is cut at the inside of its dashed border, not at the full track', () => {
  // Arrange: the fall-back day was excluded by hand after 25 h of 仕事
  const stats: HistoryStats = {
    days: [
      day('2026-09-03'),
      day('2026-09-04'),
      day('2026-09-05'),
      day('2026-09-06'),
      day('2026-09-07'),
      day('2026-09-08'),
      day('2026-09-09', { excluded: 'manual', totals: { work: 25 * H } }),
    ],
    totals: {},
    measuredDays: 0,
    streak: 0,
    excludedDays: [{ day: '2026-09-09', reason: 'manual' }],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: 130 px inside the 1 px border, and the label keeps the full 25 h
  expect(view.rows[0]?.[6]?.slices).toEqual([
    {
      activityId: 'work',
      color: '#3B7BD9',
      height: 130,
      top: true,
      bottom: true,
    },
  ])
  expect(view.rows[0]?.[6]?.ariaLabel).toBe(
    '9月9日（水）・平均から除外・仕事 25h 00m',
  )
})

test('a 25-hour fall-back day in the month calendar is cut at the 48 px cell top', () => {
  // Arrange: the fall-back day had 20 h of 仕事 and 5 h of 家事
  const stats: HistoryStats = {
    days: [
      day('2026-09-09', {
        measured: true,
        totals: { work: 20 * H, home: 5 * H },
      }),
    ],
    totals: { work: 20 * H, home: 5 * H },
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'month',
    offset: 0,
    today: '2026-09-09',
    stats,
    activities,
  })

  // Assert: 仕事 takes 40 px, 家事 gets the 8 px left instead of 10 px
  const cell = view.rows.flat().find((c) => c?.today)
  expect(cell?.slices.map((slice) => slice.height)).toEqual([40, 8])
  expect(cell?.ariaLabel).toBe('9月9日（水）・仕事 20h 00m・家事 5h 00m')
})

test('the month calendar pads Sunday-first rows and counts only the days up to today', () => {
  // Arrange
  const today = '2026-09-09'
  const days = Array.from({ length: 30 }, (_, index) =>
    day(
      `2026-09-${String(index + 1).padStart(2, '0')}`,
      index + 1 === 9 ? { measured: true } : {},
    ),
  )
  const stats: HistoryStats = {
    days,
    totals: {},
    measuredDays: 1,
    streak: 1,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'month',
    offset: 0,
    today,
    stats,
    activities: [],
  })

  // Assert
  expect(view.title).toBe('2026年9月')
  expect(view.barHeight).toBe(48)
  expect(view.detoxGlyphSize).toBe(12)
  expect(view.weekdays).toEqual(['日', '月', '火', '水', '木', '金', '土'])
  expect(view.rows).toHaveLength(5)
  expect(view.rows.flat().map((cell) => cell?.label ?? '·')).toEqual([
    '·',
    '·',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '今日',
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
    '20',
    '21',
    '22',
    '23',
    '24',
    '25',
    '26',
    '27',
    '28',
    '29',
    '30',
    '·',
    '·',
    '·',
  ])
  expect(view.rows.flat().map((cell) => cell?.kind ?? '·')).toEqual([
    '·',
    '·',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'stack',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    'empty',
    '·',
    '·',
    '·',
  ])
  expect(view.measured).toBe('1 / 9日')
})

test('stepping back titles the week by its dates and the month across the year end', () => {
  // Arrange
  const today = '2026-09-09'
  const stats: HistoryStats = {
    days: Array.from({ length: 7 }, (_, index) =>
      day(
        `2026-08-${27 + index}`
          .replace('2026-08-32', '2026-09-01')
          .replace('2026-08-33', '2026-09-02'),
      ),
    ),
    totals: {},
    measuredDays: 0,
    streak: 0,
    excludedDays: [],
  }

  // Act
  const view = historyView({
    range: 'week',
    offset: -1,
    today,
    stats,
    activities: [],
  })

  // Assert
  expect(weekStart(today, 0)).toBe('2026-09-03')
  expect(weekStart(today, -1)).toBe('2026-08-27')
  expect(view.title).toBe('8月27日 – 9月2日')
  expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  expect(shiftMonth('2026-12', 1)).toBe('2027-01')
})

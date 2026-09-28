import { expect, test } from 'vitest'

import { SETTINGS_DEFAULTS } from './settings'
import { countSwitches, daySegments, legendEntries, spanBox } from './today'

const row = (id: string, activityId: string, startedAt: string) => ({
  id,
  activityId,
  startedAt: new Date(startedAt),
})
const start = Date.parse('2026-09-08T15:00:00Z') // 2026-09-09 00:00 JST
const end = Date.parse('2026-09-09T15:00:00Z')

test('the bar carries yesterday’s state in and stops the current segment at now', () => {
  // Arrange
  const list = {
    carriedIn: row('a', 'sleep', '2026-09-08T14:00:00Z'),
    rows: [row('b', 'work', '2026-09-09T00:00:00Z')],
  }
  const now = Date.parse('2026-09-09T01:30:00Z')

  // Act
  const segments = daySegments(list, start, end, now, 720 * 60_000)

  // Assert
  expect(segments).toEqual([
    {
      switchId: 'a',
      activityId: 'sleep',
      start,
      end: Date.parse('2026-09-09T00:00:00Z'),
      idle: false,
    },
    {
      switchId: 'b',
      activityId: 'work',
      start: Date.parse('2026-09-09T00:00:00Z'),
      end: now,
      idle: false,
    },
  ])
  expect(daySegments(undefined, start, end, now, 720 * 60_000)).toEqual([])
})

test('a 12h 34m sleep stays on the bar at the default idle threshold', () => {
  // Arrange: 睡眠 1:13–13:47 JST on 2026-09-27, then 休息. Longer than the old 12 h line.
  const list = {
    carriedIn: null,
    rows: [
      row('sleep', 'sleep', '2026-09-26T16:13:00Z'),
      row('rest', 'rest', '2026-09-27T04:47:00Z'),
    ],
  }
  const dayStart = Date.parse('2026-09-26T15:00:00Z')
  const dayEnd = Date.parse('2026-09-27T15:00:00Z')
  const now = Date.parse('2026-09-27T04:48:00Z')

  // Act
  const segments = daySegments(
    list,
    dayStart,
    dayEnd,
    now,
    SETTINGS_DEFAULTS.idleThresholdMinutes * 60_000,
  )

  // Assert: the sleep span is drawn in its activity colour (idle would dash it)
  expect(segments[0]).toEqual({
    switchId: 'sleep',
    activityId: 'sleep',
    start: Date.parse('2026-09-26T16:13:00Z'),
    end: Date.parse('2026-09-27T04:47:00Z'),
    idle: false,
  })
})

test('the first row of a first day is the starting state, not a switch', () => {
  // Arrange
  const first = row('a', 'house', '2026-09-09T00:00:00Z')
  const second = row('b', 'work', '2026-09-09T01:00:00Z')

  // Act
  const firstDay = countSwitches({ carriedIn: null, rows: [first, second] })
  const laterDay = countSwitches({ carriedIn: first, rows: [second] })

  // Assert
  expect(firstDay).toBe(1)
  expect(laterDay).toBe(1)
  expect(countSwitches({ carriedIn: null, rows: [first] })).toBe(0)
  expect(countSwitches(undefined)).toBe(0)
})

test('今日 n 回切替 counts no switch for a row of the same activity as the one before it, as a merge or a cut leaves', () => {
  // Arrange: 仕事, 読書, 仕事 → 読書 merged into 仕事 leaves 仕事 twice; a cut of the carried-in 睡眠 leaves 睡眠 twice.
  const merged = {
    carriedIn: row('s', 'sleep', '2026-09-08T14:00:00Z'),
    rows: [
      row('w1', 'work', '2026-09-09T00:00:00Z'),
      row('w2', 'work', '2026-09-09T03:00:00Z'),
    ],
  }
  const cut = {
    carriedIn: row('s', 'sleep', '2026-09-08T14:00:00Z'),
    rows: [row('s2', 'sleep', '2026-09-08T18:00:00Z')],
  }

  // Act
  const afterMerge = countSwitches(merged)
  const afterCut = countSwitches(cut)

  // Assert: 睡眠 → 仕事 is the one switch; the cut is none.
  expect(afterMerge).toBe(1)
  expect(afterCut).toBe(0)
})

test('今日 n 回切替 counts a detox re-tap that renews the run as a switch', () => {
  // Arrange: detox carried in, pressed again past its week (the row renews the run).
  const detox = (id: string, startedAt: string) => ({
    ...row(id, 'unused', startedAt),
    activityId: null,
  })
  const list = {
    carriedIn: detox('d1', '2026-09-01T00:00:00Z'),
    rows: [{ ...detox('d2', '2026-09-09T00:00:00Z'), startsRun: true }],
  }

  // Act
  const switches = countSwitches(list)

  // Assert
  expect(switches).toBe(1)
})

test('the legend names each activity with a span today and adds detox when time was recorded to nothing', () => {
  // Arrange: 仕事 and 睡眠 drew spans, 家事 did not; one span is detox
  const activities = [
    { id: 'home', name: '家事', color: '#E0A431' },
    { id: 'work', name: '仕事', color: '#3B7BD9' },
    { id: 'sleep', name: '睡眠', color: '#6C63D6' },
  ]
  const segments = [
    { activityId: 'sleep' },
    { activityId: 'work' },
    { activityId: null },
    { activityId: 'work' },
  ]

  // Act
  const legend = legendEntries(activities, segments)

  // Assert: list order rather than span order, detox last and without a colour; no detox entry without a detox span
  expect(legend).toEqual([
    { id: 'work', name: '仕事', color: '#3B7BD9' },
    { id: 'sleep', name: '睡眠', color: '#6C63D6' },
    { id: 'detox', name: 'detox', color: null },
  ])
  expect(legendEntries(activities, [{ activityId: 'work' }])).toEqual([
    { id: 'work', name: '仕事', color: '#3B7BD9' },
  ])
})

test('a span touching an end of the bar takes that end’s rounded corner and width above its neighbour, so its outline is not clipped open', () => {
  // Arrange: a 0:00–24:00 bar in ms and its own corner classes
  const bounds = { start: 0, end: 86_400_000 }
  const corners = {
    first: 'rounded-l-md',
    last: 'rounded-r-md',
    endSpan: 'min-w-1.5 z-10 bg-chip',
  }

  // Act
  const carriedIn = spanBox(
    { start: -3_600_000, end: 3_600_000 },
    bounds,
    corners,
  )
  const running = spanBox(
    { start: 82_800_000, end: 86_400_000 },
    bounds,
    corners,
  )
  const wholeDay = spanBox({ start: 0, end: 86_400_000 }, bounds, corners)
  const inside = spanBox({ start: 3_600_000, end: 7_200_000 }, bounds, corners)

  // Assert: a span reaching past the start counts as touching it; a span inside the bar keeps square ends and no minimum
  expect(carriedIn).toEqual({
    className: 'rounded-l-md min-w-1.5 z-10 bg-chip',
    style: { left: '-4.166666666666666%', width: '8.333333333333332%' },
  })
  expect(running).toEqual({
    className: 'rounded-r-md min-w-1.5 z-10 bg-chip',
    style: { right: 0, width: '4.166666666666666%' },
  })
  expect(wholeDay).toEqual({
    className: 'rounded-l-md rounded-r-md min-w-1.5 z-10 bg-chip',
    style: { left: '0%', width: '100%' },
  })
  expect(inside).toEqual({
    className: '',
    style: { left: '4.166666666666666%', width: '4.166666666666666%' },
  })
})

test('five minutes of detox just before midnight stay a closed outline: the span is placed from the right, so its minimum width grows into the bar', () => {
  // Arrange: 23:55–24:00 on a 0:00–24:00 bar, narrower on screen than the bar's 7px corner
  const bounds = { start: 0, end: 86_400_000 }
  const corners = {
    first: 'rounded-l-[7px]',
    last: 'rounded-r-[7px]',
    endSpan: 'min-w-[7px] z-10 bg-chip',
  }

  // Act
  const lastMinutes = spanBox(
    { start: 86_100_000, end: 86_400_000 },
    bounds,
    corners,
  )

  // Assert
  expect(lastMinutes).toEqual({
    className: 'rounded-r-[7px] min-w-[7px] z-10 bg-chip',
    style: { right: 0, width: '0.3472222222222222%' },
  })
})

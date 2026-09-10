import { expect, test } from 'vitest'

import {
  historyView,
  shiftMonth,
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
  expect(view.weekdays).toEqual([])
  expect(view.rows).toHaveLength(1)
  expect(
    view.rows[0]?.map((cell) => [cell?.label, cell?.kind, cell?.ariaLabel]),
  ).toEqual([
    ['木', 'empty', '9月3日（木）'],
    ['金', 'empty', '9月4日（金）'],
    ['土', 'empty', '9月5日（土）'],
    ['日', 'stack', '9月6日（日）'],
    ['月', 'excluded', '9月7日（月）・計測なし'],
    ['火', 'stack', '9月8日（火）'],
    ['今日', 'stack', '9月9日（水）'],
  ])
  expect(view.rows[0]?.[5]?.slices).toEqual([
    { activityId: 'work', color: '#3B7BD9', height: 55, top: false },
    { activityId: 'old', color: '#D8579C', height: 16.5, top: true },
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

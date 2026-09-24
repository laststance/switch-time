import { ORPCError } from '@orpc/client'
import { dayBounds } from '@switch-time/shared'
import { expect, test } from 'vitest'

import {
  afterUndoFailure,
  archivedBox,
  correctionRows,
  cutStepper,
  cutNotes,
  cutTotalsEffects,
  dayBaseline,
  daySnapshot,
  dayTitle,
  isDayChangedRefusal,
  isManuallyExcluded,
  openedCut,
  pickRequest,
  revealOffset,
  rowsAfterEdit,
  undoRequest,
  undoSlotFor,
  type ListedDay,
} from './correction'

const TZ = 'Asia/Tokyo'
const MIN = 60_000
const at = (day: string, hour: number, minute = 0) =>
  new Date(dayBounds(day, TZ).start + hour * 60 * MIN + minute * MIN)
const row = (id: string, activityId: string | null, startedAt: Date) => ({
  id,
  userId: 'u',
  activityId,
  startedAt,
  source: 'tap' as const,
  revision: 0,
  createdAt: startedAt,
})
const activities = [
  { id: 'work', name: '仕事', color: '#3B7BD9', iconKey: 'work' },
  { id: 'rest', name: '休息', color: '#4FA877', iconKey: 'rest' },
  { id: 'fun', name: '娯楽', color: '#D8579C', iconKey: 'fun' },
  { id: 'sleep', name: '睡眠', color: '#6C63D6', iconKey: 'sleep' },
  { id: 'home', name: '家事', color: '#E0A431', iconKey: 'home' },
  {
    id: 'old',
    name: '旧仕事',
    color: '#3B7BD9',
    iconKey: 'work',
    archivedAt: new Date('2026-09-01T00:00:00Z'),
  },
]
const flags = (r: ReturnType<typeof correctionRows>[number]) => [
  r.name,
  r.range,
  r.duration,
  r.carriedIn,
  r.canMoveEarlier,
  r.canMoveLater,
  r.canMergePrevious,
  r.canMergeNext,
  r.canSplit,
]

test('a past day lists the carried-in record last, selectable but without move, merge or split, and clips the open state at 24:00', () => {
  // Arrange: 睡眠 from the night before, three rows on 9/8, the next switch on 9/9 (so 娯楽 really ends at 24:00).
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('s', 'sleep', at('2026-09-07', 23)),
    rows: [
      row('w', 'work', at(day, 9)),
      row('r', 'rest', at(day, 12)),
      row('f', 'fun', at(day, 18)),
    ],
    carriedOut: row('h', 'home', at('2026-09-09', 9, 55)),
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const rows = correctionRows(list, activities, bounds)

  // Assert: 娯楽 cannot split (its midpoint falls on 9/9) nor merge into the next record (9/9's 家事, which undo would lose);
  // 仕事 merges into the carried-in 睡眠.
  expect(rows.map(flags)).toEqual([
    ['娯楽', '18:00 – 24:00', '6h 00m', false, true, true, true, false, false],
    ['休息', '12:00 – 18:00', '6h 00m', false, true, true, true, true, true],
    ['仕事', '9:00 – 12:00', '3h 00m', false, true, true, true, true, true],
    ['睡眠', '0:00 – 9:00', '9h 00m', true, false, false, false, false, false],
  ])
  expect(rows.map((r) => [r.id, r.color, r.iconKey])).toEqual([
    ['f', '#D8579C', 'fun'],
    ['r', '#4FA877', 'rest'],
    ['w', '#3B7BD9', 'work'],
    ['s', '#6C63D6', 'sleep'],
  ])
  expect(rows.map((r) => r.startLabel)).toEqual([
    '18:00',
    '12:00',
    '9:00',
    '0:00',
  ])
  expect(rows[0]?.start).toBe(at(day, 18).getTime())
  expect(rows[0]?.end).toBe(bounds.end)
  expect(rows[3]?.start).toBe(bounds.start)
  // Only the carried-in record names its true start with the date, and only it offers 区切る時刻 (0:00 – 8:45, from 4:15).
  expect(rows[3]?.trueStartLabel).toBe('9月7日 23:00')
  expect(rows[3]?.cut).toEqual({
    min: bounds.start,
    max: at(day, 8, 45).getTime(),
    initial: at(day, 4, 15).getTime(),
  })
  expect(rows.slice(0, 3).map((r) => r.cut)).toEqual([null, null, null])
})

test('the last row cannot merge into the next day’s switch even when that switch sits exactly on midnight', () => {
  // Arrange: 仕事 9:00 and 娯楽 18:00 on 9/8 (the first states ever); 家事 at 9/9 0:00 sharp closes 娯楽 on the day's very end.
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: null,
    rows: [row('w', 'work', at(day, 9)), row('f', 'fun', at(day, 18))],
    carriedOut: row('h', 'home', at('2026-09-09', 0)),
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const rows = correctionRows(list, activities, bounds)

  // Assert: 娯楽 still splits (its 21:00 midpoint is inside 9/8) but must not hand its span to 9/9's 家事, which 「元に戻す」 on
  // 9/8 would drop; 仕事 merges into 娯楽 but has no previous record.
  expect(rows.map(flags)).toEqual([
    ['娯楽', '18:00 – 24:00', '6h 00m', false, true, true, true, false, true],
    ['仕事', '9:00 – 18:00', '9h 00m', false, true, true, false, true, true],
  ])
})

test('a detox row names itself, has no colour and keeps every correction', () => {
  // Arrange: 仕事 9:00, detox 12:00, 娯楽 18:00 on a past day; the detox span is the one in the middle.
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: null,
    rows: [
      row('w', 'work', at(day, 9)),
      row('d', null, at(day, 12)),
      row('f', 'fun', at(day, 18)),
    ],
    carriedOut: row('h', 'home', at('2026-09-09', 8)),
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const rows = correctionRows(list, activities, bounds)

  // Assert: the detox row is drawn without a colour and with the wind glyph; 「元に戻す」 writes it back as null.
  expect(rows.map(flags)[1]).toEqual([
    'detox',
    '12:00 – 18:00',
    '6h 00m',
    false,
    true,
    true,
    true,
    true,
    true,
  ])
  expect(rows.map((r) => [r.id, r.activityId, r.color, r.iconKey])[1]).toEqual([
    'd',
    null,
    null,
    'wind',
  ])
  expect(daySnapshot(list.rows)[1]).toEqual({
    activityId: null,
    startedAt: at(day, 12),
  })
})

test('today keeps the first row at or after 0:00 and the current row out of the future', () => {
  // Arrange: 仕事 since midnight (so the carried-in 睡眠 has nothing left to show), 家事 tapped one minute ago.
  const day = '2026-09-09'
  const list: ListedDay = {
    carriedIn: row('s', 'sleep', at('2026-09-08', 23)),
    rows: [row('w', 'work', at(day, 0)), row('h', 'home', at(day, 9, 59))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at(day, 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const rows = correctionRows(list, activities, bounds)

  // Assert: 家事 cannot move later (now − 1 min is where it is), split (a 30 s half) nor merge into a next record (it is the
  // current state); 仕事 cannot move before 0:00 but merges both ways; the zero-length 睡眠 row is not listed.
  expect(rows.map(flags)).toEqual([
    ['家事', '9:59 – いま', '1m', false, true, false, true, false, false],
    ['仕事', '0:00 – 9:59', '9h 59m', false, false, true, true, true, true],
  ])
  expect(correctionRows(undefined, activities, bounds)).toEqual([])
  expect(correctionRows(list, undefined, bounds)).toEqual([])
})

test('the title names the day unless it is today, and the baseline an edit sends holds the day’s own rows with their ids and the switch its last row runs into', () => {
  // Arrange
  const list: ListedDay = {
    carriedIn: row('s', 'sleep', at('2026-09-07', 23)),
    rows: [row('w', 'work', at('2026-09-08', 9))],
    carriedOut: row('t', 'home', at('2026-09-09', 8)),
  }

  // Act & Assert
  expect(dayTitle('2026-09-09', '2026-09-09')).toBe('今日の記録を訂正')
  expect(dayTitle('2026-09-08', '2026-09-09')).toBe('9月8日（火）の記録を訂正')
  expect(dayBaseline('2026-09-08', TZ, list)).toEqual({
    day: '2026-09-08',
    timeZone: TZ,
    rows: [{ id: 'w', activityId: 'work', startedAt: at('2026-09-08', 9) }],
    carriedOutId: 't',
  })
})

test('区切る時刻 reaches 0:00 on a record that began the night before and stops a quarter hour before the next switch', () => {
  // Arrange: 仕事 from 9/7 22:00 runs into 9/8 until 家事 at 7:00 (the e2e fixture's shape).
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('w', 'work', at('2026-09-07', 22)),
    rows: [row('h', 'home', at(day, 7))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const carriedIn = correctionRows(list, activities, bounds).at(-1)

  // Assert: 0:00 – 6:45 has 27 quarters, so the midpoint 3:22:30 ties and rounds down to 3:15.
  expect(carriedIn?.cut).toEqual({
    min: at(day, 0).getTime(),
    max: at(day, 6, 45).getTime(),
    initial: at(day, 3, 15).getTime(),
  })
})

test('区切る時刻 keeps a minute from the record’s true start and from the next switch, on quarter hours', () => {
  // Arrange: one record began 30 s before midnight and the next switch comes at 7:01.
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('w', 'work', new Date(at(day, 0).getTime() - 30_000)),
    rows: [row('h', 'home', at(day, 7, 1))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const carriedIn = correctionRows(list, activities, bounds).at(-1)

  // Assert: the earliest cut is 0:15 (0:00:30 rounded up), the latest 7:00 (exactly a minute before 7:01).
  expect(carriedIn?.cut?.min).toBe(at(day, 0, 15).getTime())
  expect(carriedIn?.cut?.max).toBe(at(day, 7).getTime())
})

test('区切る時刻 on a record that covers the whole past day ends at 23:45, never at 24:00', () => {
  // Arrange: 仕事 from 9/7 22:00 until 家事 on 9/9 at 9:00; 9/8 has no row of its own.
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('w', 'work', at('2026-09-07', 22)),
    rows: [],
    carriedOut: row('h', 'home', at('2026-09-09', 9)),
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const rows = correctionRows(list, activities, bounds)

  // Assert
  expect(rows.map((r) => [r.name, r.range, r.carriedIn])).toEqual([
    ['仕事', '0:00 – 24:00', true],
  ])
  expect(rows[0]?.cut).toEqual({
    min: at(day, 0).getTime(),
    max: at(day, 23, 45).getTime(),
    initial: at(day, 11, 45).getTime(),
  })
})

test('区切る時刻 on today’s current record stays a quarter hour and a minute short of now, for a device clock running fast', () => {
  // Arrange: 睡眠 since last night is still running at 10:07 today.
  const day = '2026-09-09'
  const list: ListedDay = {
    carriedIn: row('s', 'sleep', at('2026-09-08', 23)),
    rows: [],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at(day, 10, 7).getTime(),
    timeZone: TZ,
  }

  // Act
  const carriedIn = correctionRows(list, activities, bounds)[0]

  // Assert: 10:07 less 15 min and a minute is 9:51, which rounds down to 9:45; 0:00 – 9:45 has 39 quarters, so it opens at 4:45.
  expect(carriedIn?.range).toBe('0:00 – いま')
  expect(carriedIn?.cut).toEqual({
    min: at(day, 0).getTime(),
    max: at(day, 9, 45).getTime(),
    initial: at(day, 4, 45).getTime(),
  })
})

test('区切る時刻 is not offered when no quarter hour keeps a minute from both ends', () => {
  // Arrange: a record from 30 s before midnight to 0:14.
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('w', 'work', new Date(at(day, 0).getTime() - 30_000)),
    rows: [row('h', 'home', at(day, 0, 14))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const carriedIn = correctionRows(list, activities, bounds).at(-1)

  // Assert
  expect(carriedIn?.carriedIn).toBe(true)
  expect(carriedIn?.cut).toBeNull()
})

test('the origin note names a record started two days earlier by that day’s date', () => {
  // Arrange: 睡眠 from 9/6 22:00 runs through 9/7 into 9/8.
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('s', 'sleep', at('2026-09-06', 22)),
    rows: [row('w', 'work', at(day, 9))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const carriedIn = correctionRows(list, activities, bounds).at(-1)

  // Assert
  expect(carriedIn?.trueStartLabel).toBe('9月6日 22:00')
  expect(carriedIn?.trueStartDate).toBe('9月6日')
})

// The carried-in 仕事 of 9/7 22:00 → 9/8 7:00 (cut range 0:00 – 6:45, from 3:15), as the e2e fixture has it.
const carriedWork = () => {
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('w', 'work', at('2026-09-07', 22)),
    rows: [row('h', 'home', at(day, 7))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }
  const rows = correctionRows(list, activities, bounds)
  const carriedIn = rows.at(-1)
  if (!carriedIn) throw new Error('no carried-in row')
  return { day, list, bounds, rows, carriedIn }
}

test('the cut stepper opens at the middle quarter and keeps a chosen time while it stays in range', () => {
  // Arrange
  const { day, carriedIn } = carriedWork()

  // Act
  const opened = cutStepper(carriedIn, null, TZ)
  const chosen = cutStepper(
    carriedIn,
    { id: 'w', at: at(day, 3).getTime() },
    TZ,
  )

  // Assert
  expect([opened.at, opened.label]).toEqual([at(day, 3, 15).getTime(), '3:15'])
  expect([chosen.at, chosen.label]).toEqual([at(day, 3).getTime(), '3:00'])
})

test('the cut stepper goes back to the middle after a cut shrinks the record past the chosen time', () => {
  // Arrange: after a cut at 3:00 the carried-in record ends at 3:00 (range 0:00 – 2:45).
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('w', 'work', at('2026-09-07', 22)),
    rows: [row('c', 'work', at(day, 3)), row('h', 'home', at(day, 7))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }
  const carriedIn = correctionRows(list, activities, bounds).at(-1)
  if (!carriedIn) throw new Error('no carried-in row')

  // Act
  const stepper = cutStepper(
    carriedIn,
    { id: 'w', at: at(day, 3).getTime() },
    TZ,
  )

  // Assert: 0:00 – 2:45 has 11 quarters; the middle rounds down to 1:15.
  expect(stepper.label).toBe('1:15')
})

test('the cut stepper starts from the middle again when another row was chosen before', () => {
  // Arrange
  const { day, carriedIn } = carriedWork()

  // Act
  const stepper = cutStepper(
    carriedIn,
    { id: 'h', at: at(day, 1).getTime() },
    TZ,
  )

  // Assert
  expect(stepper.label).toBe('3:15')
})

test('the cut stepper keeps a chosen time on today’s current record as the clock moves on', () => {
  // Arrange: 睡眠 since last night; 10:00 was chosen at 10:22, and the clock now reads 10:36 (the range ends a quarter and a minute before now).
  const day = '2026-09-09'
  const list: ListedDay = {
    carriedIn: row('s', 'sleep', at('2026-09-08', 23)),
    rows: [],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at(day, 10, 36).getTime(),
    timeZone: TZ,
  }
  const carriedIn = correctionRows(list, activities, bounds)[0]
  if (!carriedIn) throw new Error('no carried-in row')

  // Act
  const stepper = cutStepper(
    carriedIn,
    { id: 's', at: at(day, 10).getTime() },
    TZ,
  )

  // Assert: the chosen 10:00 stays, and +15分 now reaches 10:15.
  expect(stepper.label).toBe('10:00')
  expect(stepper.targets[15]).toBe(at(day, 10, 15).getTime())
  expect(stepper.targets[60]).toBe(at(day, 10, 15).getTime())
})

test('the cut time the panel opened with stays put on today’s current record as the clock moves the range’s middle', () => {
  // Arrange: 睡眠 since last night; the panel opened at 10:36 (range 0:00 – 10:15) and the clock now reads 12:36 (0:00 – 12:15).
  const day = '2026-09-09'
  const list: ListedDay = {
    carriedIn: row('s', 'sleep', at('2026-09-08', 23)),
    rows: [],
    carriedOut: null,
  }
  const rowAt = (now: Date) =>
    correctionRows(list, activities, {
      ...dayBounds(day, TZ),
      now: now.getTime(),
      timeZone: TZ,
    })[0]
  const whenOpened = rowAt(at(day, 10, 36))
  const later = rowAt(at(day, 12, 36))
  if (!whenOpened || !later) throw new Error('no carried-in row')

  // Act
  const stepper = cutStepper(later, openedCut(whenOpened), TZ)

  // Assert: the panel still reads 5:00, the middle it opened with, not 6:00, today's middle by now.
  expect(stepper.label).toBe('5:00')
  expect(cutStepper(later, null, TZ).label).toBe('6:00')
})

test('a carried-in panel with no quarter hour to cut at opens with no cut time', () => {
  // Arrange: 睡眠 from 30 s before midnight, and the clock at 0:14 leaves no quarter hour.
  const day = '2026-09-09'
  const carriedIn = correctionRows(
    {
      carriedIn: row('s', 'sleep', new Date(at(day, 0).getTime() - 30_000)),
      rows: [],
      carriedOut: null,
    },
    activities,
    { ...dayBounds(day, TZ), now: at(day, 0, 14).getTime(), timeZone: TZ },
  )[0]
  if (!carriedIn) throw new Error('no carried-in row')

  // Act
  const stepper = cutStepper(carriedIn, openedCut(carriedIn), TZ)

  // Assert
  expect(openedCut(carriedIn)).toBeNull()
  expect(stepper.label).toBe('—')
})

test('a cut step stops at the range’s edge and the buttons pointing past it are disabled', () => {
  // Arrange
  const { day, carriedIn } = carriedWork()

  // Act
  const nearStart = cutStepper(
    carriedIn,
    { id: 'w', at: at(day, 0, 30).getTime() },
    TZ,
  )
  const atStart = cutStepper(
    carriedIn,
    { id: 'w', at: at(day, 0).getTime() },
    TZ,
  )
  const atEnd = cutStepper(
    carriedIn,
    { id: 'w', at: at(day, 6, 45).getTime() },
    TZ,
  )

  // Assert: from 0:30, −1時間 lands on 0:00; at 0:00 nothing earlier is offered; at 6:45 nothing later.
  expect(nearStart.targets).toEqual({
    [-60]: at(day, 0).getTime(),
    [-15]: at(day, 0, 15).getTime(),
    [15]: at(day, 0, 45).getTime(),
    [60]: at(day, 1, 30).getTime(),
  })
  expect([atStart.targets[-60], atStart.targets[-15]]).toEqual([null, null])
  expect([atEnd.targets[15], atEnd.targets[60]]).toEqual([null, null])
})

test('without a cut range the stepper shows a dash and every step is disabled', () => {
  // Arrange: a record from 30 s before midnight to 0:14 leaves no quarter hour.
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('w', 'work', new Date(at(day, 0).getTime() - 30_000)),
    rows: [row('h', 'home', at(day, 0, 14))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }
  const carriedIn = correctionRows(list, activities, bounds).at(-1)
  if (!carriedIn) throw new Error('no carried-in row')

  // Act
  const stepper = cutStepper(carriedIn, null, TZ)

  // Assert
  expect(stepper).toEqual({
    at: null,
    label: '—',
    targets: { [-60]: null, [-15]: null, [15]: null, [60]: null },
  })
})

test('a pick on the carried-in record arms an undo that puts only its previous activity back, at the revision the pick left', () => {
  // Arrange
  const { day, list, bounds, carriedIn } = carriedWork()
  const returned = { ...row('w', 'sleep', at('2026-09-07', 22)), revision: 4 }

  // Act
  const slot = undoSlotFor(
    { kind: 'pick', returned },
    carriedIn,
    dayBaseline(day, TZ, list),
    bounds,
  )

  // Assert
  expect(slot).toEqual({
    kind: 'activity',
    day: '2026-09-08',
    id: 'w',
    to: 'work',
    revision: 4,
  })
})

test('a pick on a carried-in detox record arms an undo back to detox', () => {
  // Arrange
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('d', null, at('2026-09-07', 22)),
    rows: [row('h', 'home', at(day, 7))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }
  const carriedIn = correctionRows(list, activities, bounds).at(-1)
  if (!carriedIn) throw new Error('no carried-in row')
  const returned = { ...row('d', 'sleep', at('2026-09-07', 22)), revision: 1 }

  // Act
  const slot = undoSlotFor(
    { kind: 'pick', returned },
    carriedIn,
    dayBaseline(day, TZ, list),
    bounds,
  )

  // Assert
  expect(slot).toEqual({
    kind: 'activity',
    day,
    id: 'd',
    to: null,
    revision: 1,
  })
})

test('a pick away from an archived activity on the carried-in record arms no undo', () => {
  // Arrange: the carried-in record holds 旧仕事, archived since.
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('o', 'old', at('2026-09-07', 22)),
    rows: [row('h', 'home', at(day, 7))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }
  const carriedIn = correctionRows(list, activities, bounds).at(-1)
  if (!carriedIn) throw new Error('no carried-in row')
  const returned = { ...row('o', 'sleep', at('2026-09-07', 22)), revision: 1 }

  // Act
  const slot = undoSlotFor(
    { kind: 'pick', returned },
    carriedIn,
    dayBaseline(day, TZ, list),
    bounds,
  )

  // Assert
  expect(slot).toEqual({ blocked: 'archived' })
})

test('a cut arms the day undo, which expects the new row, writes back the day without it and selects the carried-in record again', () => {
  // Arrange: 「ここで分割」 at 3:15 left a new 仕事 row on the day.
  const { day, list, bounds, carriedIn } = carriedWork()
  const inserted = row('n', 'work', at(day, 3, 15))

  // Act
  const slot = undoSlotFor(
    { kind: 'cut', returned: inserted },
    carriedIn,
    dayBaseline(day, TZ, list),
    bounds,
  )

  // Assert
  expect(slot).toEqual({
    kind: 'day',
    day,
    timeZone: TZ,
    rows: [{ activityId: 'home', startedAt: at(day, 7) }],
    expected: [
      { id: 'n', activityId: 'work', startedAt: at(day, 3, 15) },
      { id: 'h', activityId: 'home', startedAt: at(day, 7) },
    ],
    carriedOutId: null,
    reselectId: 'w',
  })
})

test('a move of the day’s own row arms the day undo that expects the moved start, without a reselection', () => {
  // Arrange
  const { day, list, bounds, rows } = carriedWork()
  const ownRow = rows[0]
  if (!ownRow) throw new Error('no own row')
  const moved = row('h', 'home', at(day, 7, 15))

  // Act
  const slot = undoSlotFor(
    { kind: 'move', returned: moved },
    ownRow,
    dayBaseline(day, TZ, list),
    bounds,
  )

  // Assert
  expect(slot).toEqual({
    kind: 'day',
    day,
    timeZone: TZ,
    rows: [{ activityId: 'home', startedAt: at(day, 7) }],
    expected: [{ id: 'h', activityId: 'home', startedAt: at(day, 7, 15) }],
    carriedOutId: null,
    reselectId: null,
  })
})

test('a pick on the day’s own row goes through the day undo, which expects the picked activity', () => {
  // Arrange
  const { day, list, bounds, rows } = carriedWork()
  const ownRow = rows[0]
  if (!ownRow) throw new Error('no own row')
  const picked = { ...row('h', 'sleep', at(day, 7)), revision: 1 }

  // Act
  const slot = undoSlotFor(
    { kind: 'pick', returned: picked },
    ownRow,
    dayBaseline(day, TZ, list),
    bounds,
  )

  // Assert
  expect(slot).toEqual({
    kind: 'day',
    day,
    timeZone: TZ,
    rows: [{ activityId: 'home', startedAt: at(day, 7) }],
    expected: [{ id: 'h', activityId: 'sleep', startedAt: at(day, 7) }],
    carriedOutId: null,
    reselectId: null,
  })
})

test('the day after a merge into the previous row lacks the merged row, and the kept row is as returned', () => {
  // Arrange: 仕事 9:00, 休息 12:00, 家 18:00; 休息 merges into 仕事.
  const day = '2026-09-08'
  const before = [
    { id: 'w', activityId: 'work', startedAt: at(day, 9) },
    { id: 'r', activityId: 'rest', startedAt: at(day, 12) },
    { id: 'h', activityId: 'home', startedAt: at(day, 18) },
  ]
  const kept = row('w', 'work', at(day, 9))

  // Act
  const after = rowsAfterEdit(
    before,
    { kind: 'merge', returned: kept },
    'r',
    dayBounds(day, TZ),
  )

  // Assert
  expect(after).toEqual([
    { id: 'w', activityId: 'work', startedAt: at(day, 9) },
    { id: 'h', activityId: 'home', startedAt: at(day, 18) },
  ])
})

test('the day after a merge into the next row lacks the merged row, and the kept row starts where the merged one did', () => {
  // Arrange: 休息 merges into 家, which takes 休息's 12:00 start.
  const day = '2026-09-08'
  const before = [
    { id: 'w', activityId: 'work', startedAt: at(day, 9) },
    { id: 'r', activityId: 'rest', startedAt: at(day, 12) },
    { id: 'h', activityId: 'home', startedAt: at(day, 18) },
  ]
  const kept = row('h', 'home', at(day, 12))

  // Act
  const after = rowsAfterEdit(
    before,
    { kind: 'merge', returned: kept },
    'r',
    dayBounds(day, TZ),
  )

  // Assert
  expect(after).toEqual([
    { id: 'w', activityId: 'work', startedAt: at(day, 9) },
    { id: 'h', activityId: 'home', startedAt: at(day, 12) },
  ])
})

test('the day after a merge into the carried-in record keeps only the rows still on the day', () => {
  // Arrange: the day's first row 仕事 merges into the carried-in 睡眠 of the day before.
  const day = '2026-09-08'
  const before = [
    { id: 'w', activityId: 'work', startedAt: at(day, 9) },
    { id: 'h', activityId: 'home', startedAt: at(day, 18) },
  ]
  const kept = row('s', 'sleep', at('2026-09-07', 23))

  // Act
  const after = rowsAfterEdit(
    before,
    { kind: 'merge', returned: kept },
    'w',
    dayBounds(day, TZ),
  )

  // Assert
  expect(after).toEqual([
    { id: 'h', activityId: 'home', startedAt: at(day, 18) },
  ])
})

test('the day after 半分で分割 holds the new later part in start order', () => {
  // Arrange: 仕事 9:00 – 18:00 splits at 13:30.
  const day = '2026-09-08'
  const before = [
    { id: 'w', activityId: 'work', startedAt: at(day, 9) },
    { id: 'h', activityId: 'home', startedAt: at(day, 18) },
  ]
  const inserted = row('n', 'work', at(day, 13, 30))

  // Act
  const after = rowsAfterEdit(
    before,
    { kind: 'split', returned: inserted },
    'w',
    dayBounds(day, TZ),
  )

  // Assert
  expect(after).toEqual([
    { id: 'w', activityId: 'work', startedAt: at(day, 9) },
    { id: 'n', activityId: 'work', startedAt: at(day, 13, 30) },
    { id: 'h', activityId: 'home', startedAt: at(day, 18) },
  ])
})

test('undo rewrites the day for a day slot and puts the activity back only if no other write reached the record since the pick', () => {
  // Arrange
  const daySlot = {
    kind: 'day' as const,
    day: '2026-09-08',
    timeZone: TZ,
    rows: [{ activityId: 'home', startedAt: at('2026-09-08', 7) }],
    expected: [
      { id: 'n', activityId: 'work', startedAt: at('2026-09-08', 3, 15) },
      { id: 'h', activityId: 'home', startedAt: at('2026-09-08', 7) },
    ],
    carriedOutId: 't',
    reselectId: 'w',
  }
  const activitySlot = {
    kind: 'activity' as const,
    day: '2026-09-08',
    id: 'w',
    to: 'work',
    revision: 4,
  }
  const detoxSlot = {
    kind: 'activity' as const,
    day: '2026-09-08',
    id: 'd',
    to: null,
    revision: 1,
  }

  // Act & Assert
  expect(undoRequest(daySlot)).toEqual({
    procedure: 'replaceDay',
    input: {
      day: '2026-09-08',
      timeZone: TZ,
      expected: [
        { id: 'n', activityId: 'work', startedAt: at('2026-09-08', 3, 15) },
        { id: 'h', activityId: 'home', startedAt: at('2026-09-08', 7) },
      ],
      carriedOutId: 't',
      rows: [{ activityId: 'home', startedAt: at('2026-09-08', 7) }],
    },
    reselectId: 'w',
  })
  expect(undoRequest(activitySlot)).toEqual({
    procedure: 'changeActivity',
    input: { id: 'w', activityId: 'work', revision: 4 },
  })
  expect(undoRequest(detoxSlot)).toEqual({
    procedure: 'changeActivity',
    input: { id: 'd', activityId: null, revision: 1 },
  })
})

test('a refused activity undo turns 元に戻す off, and a passing failure keeps it for another try', () => {
  // Arrange
  const answers = [
    new ORPCError('CONFLICT', { message: 'record changed elsewhere' }),
    new ORPCError('NOT_FOUND', { message: 'switch not found' }),
    new ORPCError('BAD_REQUEST', {
      message: 'activity is archived',
      data: { reason: 'archived' },
    }),
    new TypeError('Failed to fetch'),
    new ORPCError('INTERNAL_SERVER_ERROR'),
    new ORPCError('UNAUTHORIZED'),
    new ORPCError('BAD_REQUEST', { message: 'input is invalid' }),
  ]

  // Act
  const outcomes = answers.map(afterUndoFailure)

  // Assert
  expect(outcomes).toEqual([
    'clear',
    'clear',
    'archived',
    'keep',
    'keep',
    'keep',
    'keep',
  ])
})

test('only a day-changed refusal makes the sheet refetch the stored zone, so a settings update in flight is never overwritten otherwise', () => {
  // Arrange
  const answers = [
    new ORPCError('CONFLICT', {
      message: 'day changed elsewhere',
      data: { reason: 'day-changed' },
    }),
    new ORPCError('CONFLICT', { message: 'no room to move' }),
    new ORPCError('BAD_REQUEST', {
      message: 'activity is archived',
      data: { reason: 'archived' },
    }),
    new TypeError('Failed to fetch'),
    null,
  ]

  // Act
  const refetchesZone = answers.map(isDayChangedRefusal)

  // Assert
  expect(refetchesZone).toEqual([true, false, false, false, false])
})

test('the carried-in panel warns before a pick away from an archived activity and says so after it', () => {
  // Arrange: 旧仕事 (archived) carried in; after the pick the record holds 睡眠.
  const day = '2026-09-08'
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }
  const before = correctionRows(
    {
      carriedIn: row('o', 'old', at('2026-09-07', 22)),
      rows: [row('h', 'home', at(day, 7))],
      carriedOut: null,
    },
    activities,
    bounds,
  )
  const after = correctionRows(
    {
      carriedIn: row('o', 'sleep', at('2026-09-07', 22)),
      rows: [row('h', 'home', at(day, 7))],
      carriedOut: null,
    },
    activities,
    bounds,
  )

  const [archivedRecord, pickedRecord, ownRow] = [
    before.at(-1),
    after.at(-1),
    after[0],
  ]
  if (!archivedRecord || !pickedRecord || !ownRow) throw new Error('no rows')

  // Act & Assert: the notice lasts until it is cleared (the next edit or another selection), then nothing shows.
  expect(archivedBox(archivedRecord, null)).toBe('warning')
  expect(archivedBox(pickedRecord, 'o')).toBe('notice')
  expect(archivedBox(pickedRecord, null)).toBeNull()
  expect(archivedBox(ownRow, null)).toBeNull()
})

test('a live activity on the carried-in record shows no archived box', () => {
  // Arrange
  const { carriedIn } = carriedWork()

  // Act & Assert
  expect(archivedBox(carriedIn, null)).toBeNull()
})

test('a pick on the carried-in record only writes if no other write reached the record since the sheet listed it', () => {
  // Arrange
  const { day, list, rows, carriedIn } = carriedWork()
  const ownRow = rows[0]
  if (!ownRow) throw new Error('no own row')
  const baseline = dayBaseline(day, TZ, list)

  // Act & Assert: day-own rows are conditional on the day as listed instead.
  expect(pickRequest(carriedIn, 'sleep', baseline)).toEqual({
    id: 'w',
    activityId: 'sleep',
    revision: 0,
  })
  expect(pickRequest(ownRow, 'sleep', baseline)).toEqual({
    id: 'h',
    activityId: 'sleep',
    baseline: {
      day: '2026-09-08',
      timeZone: TZ,
      rows: [{ id: 'h', activityId: 'home', startedAt: at(day, 7) }],
      carriedOutId: null,
    },
  })
})

// The carried-in 仕事 from 9/7 22:00 over the whole of 9/8 (26 h so far), which has no row of its own.
const wholeDayWork = () => {
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('w', 'work', at('2026-09-07', 22)),
    rows: [],
    carriedOut: row('h', 'home', at('2026-09-09', 0)),
  }
  const bounds = {
    ...dayBounds(day, TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }
  const carriedIn = correctionRows(list, activities, bounds)[0]
  if (!carriedIn) throw new Error('no carried-in row')
  return carriedIn
}

test('the idle line appears only for a cut that leaves a part within the threshold, and an untapped past day becomes measured', () => {
  // Arrange: 26 h (9/7 22:00 – 9/9 0:00) against a 12 h threshold, on a past day with no row, auto-exclusion on.
  const carriedIn = wholeDayWork()
  const day = '2026-09-08'
  const facts = {
    idleThresholdMs: 12 * 3_600_000,
    autoExcludeUnusedDays: true,
    manuallyExcluded: false,
    hasOwnRows: false,
    isToday: false,
  }

  // Act & Assert
  // The opening 11:45 leaves 13h45 and 12h15, both still idle.
  expect(carriedIn.cut?.initial).toBe(at(day, 11, 45).getTime())
  expect(cutTotalsEffects(carriedIn, facts, at(day, 11, 45).getTime())).toEqual(
    ['unmeasured'],
  )
  // 12:45 leaves 11h15 after the cut, which counts.
  expect(cutTotalsEffects(carriedIn, facts, at(day, 12, 45).getTime())).toEqual(
    ['idle', 'unmeasured'],
  )
  // 9:45 leaves 11h45 before the cut, which counts.
  expect(
    cutTotalsEffects(
      carriedIn,
      { ...facts, hasOwnRows: true },
      at(day, 9, 45).getTime(),
    ),
  ).toEqual(['idle'])
})

test('a cut that leaves a part of exactly the threshold brings that part into the totals, as the totals judge idle', () => {
  // Arrange: the 26 h whole-day record (9/7 22:00 – 9/9 0:00) against a 12 h threshold, on a day with its own rows.
  const carriedIn = wholeDayWork()
  const facts = {
    idleThresholdMs: 12 * 3_600_000,
    autoExcludeUnusedDays: true,
    manuallyExcluded: false,
    hasOwnRows: true,
    isToday: false,
  }
  const tenOClock = at('2026-09-08', 10).getTime()

  // Act & Assert: at 10:00 the part before the cut is exactly 12 h, which is not idle (a strict "longer than"); a
  // millisecond later it is 12 h and 1 ms, and the other part is still 14 h.
  expect(cutTotalsEffects(carriedIn, facts, tenOClock)).toEqual(['idle'])
  expect(cutTotalsEffects(carriedIn, facts, tenOClock + 1)).toEqual([])
})

test('a cut of a record longer than twice the threshold never frees idle time', () => {
  // Arrange: 睡眠 from 9/6 22:00 until 9/9 22:00 is 72 h, against a 12 h threshold, viewed on 9/8.
  const day = '2026-09-08'
  const carriedIn = correctionRows(
    {
      carriedIn: row('s', 'sleep', at('2026-09-06', 22)),
      rows: [],
      carriedOut: row('h', 'home', at('2026-09-09', 22)),
    },
    activities,
    {
      ...dayBounds(day, TZ),
      now: at('2026-09-10', 10).getTime(),
      timeZone: TZ,
    },
  )[0]
  if (!carriedIn) throw new Error('no carried-in row')
  const facts = {
    idleThresholdMs: 12 * 3_600_000,
    autoExcludeUnusedDays: true,
    manuallyExcluded: false,
    hasOwnRows: true,
    isToday: false,
  }

  // Act & Assert: both parts stay over 12 h at the day's first and last quarter.
  expect(cutTotalsEffects(carriedIn, facts, at(day, 0).getTime())).toEqual([])
  expect(cutTotalsEffects(carriedIn, facts, at(day, 23, 45).getTime())).toEqual(
    [],
  )
})

test('a carried-in detox record never reports idle time, since detox is never idle', () => {
  // Arrange: detox from 9/7 22:00 until 9/9 0:00, 26 h against a 12 h threshold.
  const day = '2026-09-08'
  const carriedIn = correctionRows(
    {
      carriedIn: row('d', null, at('2026-09-07', 22)),
      rows: [],
      carriedOut: row('h', 'home', at('2026-09-09', 0)),
    },
    activities,
    {
      ...dayBounds(day, TZ),
      now: at('2026-09-09', 10).getTime(),
      timeZone: TZ,
    },
  )[0]
  if (!carriedIn) throw new Error('no carried-in row')

  // Act
  const effects = cutTotalsEffects(
    carriedIn,
    {
      idleThresholdMs: 12 * 3_600_000,
      autoExcludeUnusedDays: true,
      manuallyExcluded: false,
      hasOwnRows: true,
      isToday: false,
    },
    at(day, 12, 45).getTime(),
  )

  // Assert
  expect(effects).toEqual([])
})

test('the 計測 line waits while the excluded-day list is still loading', () => {
  // Arrange: a threshold past the record's 26 h, so only the 計測 line is under test.
  const carriedIn = wholeDayWork()

  // Act
  const effects = cutTotalsEffects(
    carriedIn,
    {
      idleThresholdMs: 48 * 3_600_000,
      autoExcludeUnusedDays: true,
      manuallyExcluded: null,
      hasOwnRows: false,
      isToday: false,
    },
    at('2026-09-08', 11, 45).getTime(),
  )

  // Assert
  expect(effects).toEqual([])
})

test('a manual exclusion of the viewed day is found, and is unknown until the list loads', () => {
  // Arrange
  const rows = [
    { day: '2026-09-07', reason: 'manual' },
    { day: '2026-09-08', reason: 'auto' },
  ]

  // Act & Assert
  expect(isManuallyExcluded(undefined, '2026-09-08')).toBeNull()
  expect(isManuallyExcluded(rows, '2026-09-08')).toBe(false)
  expect(isManuallyExcluded(rows, '2026-09-07')).toBe(true)
})

test('the cut says nothing about 計測 on today, on a manually excluded day or without auto-exclusion', () => {
  // Arrange: a threshold past the record's 26 h, so only the 計測 line is under test.
  const carriedIn = wholeDayWork()
  const facts = {
    idleThresholdMs: 48 * 3_600_000,
    autoExcludeUnusedDays: true,
    manuallyExcluded: false,
    hasOwnRows: false,
    isToday: false,
  }

  const cutAt = at('2026-09-08', 11, 45).getTime()

  // Act & Assert
  expect(
    cutTotalsEffects(carriedIn, { ...facts, isToday: true }, cutAt),
  ).toEqual([])
  expect(
    cutTotalsEffects(carriedIn, { ...facts, manuallyExcluded: true }, cutAt),
  ).toEqual([])
  expect(
    cutTotalsEffects(
      carriedIn,
      { ...facts, autoExcludeUnusedDays: false },
      cutAt,
    ),
  ).toEqual([])
})

test('a short carried-in record on a day with its own rows changes nothing in the totals', () => {
  // Arrange: 9 h of 仕事 under a 12 h threshold, and 9/8 has 家事 at 7:00.
  const { carriedIn } = carriedWork()

  // Act
  const effects = cutTotalsEffects(
    carriedIn,
    {
      idleThresholdMs: 12 * 3_600_000,
      autoExcludeUnusedDays: true,
      manuallyExcluded: false,
      hasOwnRows: true,
      isToday: false,
    },
    carriedIn.cut?.initial ?? null,
  )

  // Assert
  expect(effects).toEqual([])
})

test('selecting a card scrolls only as far as it takes to show the whole card', () => {
  // Arrange: a 600 px viewport scrolled to 200.
  const viewport = { scrollY: 200, viewportHeight: 600 }

  // Act & Assert
  // Fully visible: nothing moves.
  expect(revealOffset({ top: 300, height: 200 }, viewport)).toBeNull()
  // Below the fold: its bottom lines up with the viewport's bottom.
  expect(revealOffset({ top: 700, height: 300 }, viewport)).toBe(400)
  // Above: its top lines up with the viewport's top.
  expect(revealOffset({ top: 100, height: 200 }, viewport)).toBe(100)
  // Taller than the viewport: its header goes to the top.
  expect(revealOffset({ top: 700, height: 900 }, viewport)).toBe(700)
})

test('the lines under ここで分割 spell each totals effect, or why no cut is offered', () => {
  // Arrange: the whole-day 26 h record on an untapped past day, and a record with no quarter hour to cut at.
  const wholeDay = wholeDayWork()
  const day = '2026-09-08'
  const tooShort = correctionRows(
    {
      carriedIn: row('w', 'work', new Date(at(day, 0).getTime() - 30_000)),
      rows: [row('h', 'home', at(day, 0, 14))],
      carriedOut: null,
    },
    activities,
    {
      ...dayBounds(day, TZ),
      now: at('2026-09-09', 10).getTime(),
      timeZone: TZ,
    },
  ).at(-1)
  if (!tooShort) throw new Error('no carried-in row')
  const facts = {
    idleThresholdMs: 12 * 3_600_000,
    autoExcludeUnusedDays: true,
    manuallyExcluded: false,
    hasOwnRows: false,
    isToday: false,
  }

  // Act & Assert: at 12:45 the 11h15 after the cut counts.
  expect(cutNotes(wholeDay, facts, at(day, 12, 45).getTime())).toEqual([
    '区切ると、無操作扱い（12時間超）だった時間が集計に入ります',
    '区切ると、この日は計測できた日になります',
  ])
  expect(cutNotes(tooShort, facts, null)).toEqual([
    '15分単位で区切れる時刻がありません',
  ])
})

test('a day that has not begun yet lists nothing, so the running record offers no cut in the future', () => {
  // Arrange: 仕事 has run since 9/9 9:00; the sheet is opened for 9/10 while the clock reads 9/9 10:00.
  const list: ListedDay = {
    carriedIn: row('w', 'work', at('2026-09-09', 9)),
    rows: [],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds('2026-09-10', TZ),
    now: at('2026-09-09', 10).getTime(),
    timeZone: TZ,
  }

  // Act
  const rows = correctionRows(list, activities, bounds)

  // Assert
  expect(rows).toEqual([])
})

test('区切る時刻 lands on the wall clock’s quarter hours in a zone offset by 5:45', () => {
  // Arrange: in Asia/Kathmandu, 仕事 from 9/7 22:00 runs into 9/8 until 家事 at 7:00.
  const zone = 'Asia/Kathmandu'
  const day = '2026-09-08'
  const list: ListedDay = {
    carriedIn: row('w', 'work', new Date('2026-09-07T22:00:00+05:45')),
    rows: [row('h', 'home', new Date('2026-09-08T07:00:00+05:45'))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, zone),
    now: new Date('2026-09-09T10:00:00+05:45').getTime(),
    timeZone: zone,
  }
  const carriedIn = correctionRows(list, activities, bounds).at(-1)
  if (!carriedIn) throw new Error('no carried-in row')

  // Act
  const stepper = cutStepper(carriedIn, null, zone)

  // Assert: 0:00 – 6:45 local, opening at 3:15 local, exactly as in Tokyo.
  expect(carriedIn.cut).toEqual({
    min: new Date('2026-09-08T00:00:00+05:45').getTime(),
    max: new Date('2026-09-08T06:45:00+05:45').getTime(),
    initial: new Date('2026-09-08T03:15:00+05:45').getTime(),
  })
  expect(stepper.label).toBe('3:15')
})

test('区切る時刻 stays on quarter hours across the spring-forward gap of a 23-hour day', () => {
  // Arrange: in America/New_York on 2026-03-08 (2:00 jumps to 3:00), 仕事 from 3/7 22:00 runs until 家事 at 7:00.
  const zone = 'America/New_York'
  const day = '2026-03-08'
  const list: ListedDay = {
    carriedIn: row('w', 'work', new Date('2026-03-07T22:00:00-05:00')),
    rows: [row('h', 'home', new Date('2026-03-08T07:00:00-04:00'))],
    carriedOut: null,
  }
  const bounds = {
    ...dayBounds(day, zone),
    now: new Date('2026-03-09T10:00:00-04:00').getTime(),
    timeZone: zone,
  }
  const carriedIn = correctionRows(list, activities, bounds).at(-1)
  if (!carriedIn) throw new Error('no carried-in row')

  // Act
  const stepper = cutStepper(carriedIn, null, zone)

  // Assert: 6 elapsed hours in the day, so 0:00 – 6:45 has 23 quarters; the 11th past 0:00 reads 3:45 after the jump.
  expect(carriedIn.cut).toEqual({
    min: new Date('2026-03-08T00:00:00-05:00').getTime(),
    max: new Date('2026-03-08T06:45:00-04:00').getTime(),
    initial: new Date('2026-03-08T03:45:00-04:00').getTime(),
  })
  expect(stepper.label).toBe('3:45')
})

test('the idle line appears only once the running record is longer than the threshold, as the totals judge idle', () => {
  // Arrange: 睡眠 since 9/8 23:00 is still running on 9/9, which already has no row of its own.
  const day = '2026-09-09'
  const list: ListedDay = {
    carriedIn: row('s', 'sleep', at('2026-09-08', 23)),
    rows: [],
    carriedOut: null,
  }
  const boundsAt = (now: number) => ({
    ...dayBounds(day, TZ),
    now,
    timeZone: TZ,
  })
  const facts = {
    idleThresholdMs: 12 * 3_600_000,
    autoExcludeUnusedDays: true,
    manuallyExcluded: false,
    hasOwnRows: false,
    isToday: true,
  }
  const exactly = correctionRows(
    list,
    activities,
    boundsAt(at(day, 11).getTime()),
  )[0]
  const over = correctionRows(
    list,
    activities,
    boundsAt(at(day, 11).getTime() + 1),
  )[0]
  if (!exactly || !over) throw new Error('no carried-in row')

  // Act & Assert: exactly 12 h is not idle (segmentsInRange uses a strict "longer than"); a millisecond more is.
  expect(cutTotalsEffects(exactly, facts, at(day, 5).getTime())).toEqual([])
  expect(cutTotalsEffects(over, facts, at(day, 5).getTime())).toEqual(['idle'])
})

test('the idle line names a threshold that is not whole hours in minutes', () => {
  // Arrange: the 26 h whole-day record against a 90-minute threshold on a day with its own rows, cut at 23:45.
  const carriedIn = wholeDayWork()

  // Act: the 15 min after the cut is within 90 minutes.
  const notes = cutNotes(
    carriedIn,
    {
      idleThresholdMs: 90 * 60_000,
      autoExcludeUnusedDays: true,
      manuallyExcluded: false,
      hasOwnRows: true,
      isToday: false,
    },
    at('2026-09-08', 23, 45).getTime(),
  )

  // Assert
  expect(notes).toEqual([
    '区切ると、無操作扱い（90分超）だった時間が集計に入ります',
  ])
})

test('the day’s own rows never report a totals effect of a cut', () => {
  // Arrange: 9/8's own 家事 row, with facts under which a carried-in record would report both effects.
  const { rows } = carriedWork()
  const ownRow = rows[0]
  if (!ownRow) throw new Error('no own row')

  // Act
  const effects = cutTotalsEffects(
    ownRow,
    {
      idleThresholdMs: 60_000,
      autoExcludeUnusedDays: true,
      manuallyExcluded: false,
      hasOwnRows: false,
      isToday: false,
    },
    at('2026-09-08', 8).getTime(),
  )

  // Assert
  expect(effects).toEqual([])
})

test('a pick on a carried-in record names the revision the day list reported for it', () => {
  // Arrange: the carried-in detox record was written twice since it was created.
  const day = '2026-09-08'
  const carriedIn = correctionRows(
    {
      carriedIn: { ...row('d', null, at('2026-09-07', 22)), revision: 2 },
      rows: [row('h', 'home', at(day, 7))],
      carriedOut: null,
    },
    activities,
    {
      ...dayBounds(day, TZ),
      now: at('2026-09-09', 10).getTime(),
      timeZone: TZ,
    },
  ).at(-1)
  if (!carriedIn) throw new Error('no carried-in row')

  // Act
  const request = pickRequest(carriedIn, 'work', undefined)

  // Assert
  expect(request).toEqual({ id: 'd', activityId: 'work', revision: 2 })
})

test('a carried-in record whose activity the cached list does not know yet shows no archived warning', () => {
  // Arrange: the record holds an activity created on another device after `activities.list` was cached.
  const day = '2026-09-08'
  const carriedIn = correctionRows(
    {
      carriedIn: row('n', 'new-elsewhere', at('2026-09-07', 22)),
      rows: [row('h', 'home', at(day, 7))],
      carriedOut: null,
    },
    activities,
    {
      ...dayBounds(day, TZ),
      now: at('2026-09-09', 10).getTime(),
      timeZone: TZ,
    },
  ).at(-1)
  if (!carriedIn) throw new Error('no carried-in row')

  // Act
  const box = archivedBox(carriedIn, null)

  // Assert: it lists nameless until the refetch, and still offers the cut.
  expect([carriedIn.name, carriedIn.archived, box]).toEqual(['…', false, null])
  expect(carriedIn.cut).not.toBeNull()
})

test('a card that exactly fills the view, or touches its edges, does not scroll', () => {
  // Arrange: a 600 px viewport scrolled to 200.
  const viewport = { scrollY: 200, viewportHeight: 600 }

  // Act & Assert
  expect(revealOffset({ top: 200, height: 600 }, viewport)).toBeNull()
  expect(revealOffset({ top: 200, height: 100 }, viewport)).toBeNull()
  expect(revealOffset({ top: 700, height: 100 }, viewport)).toBeNull()
  // One pixel past the bottom edge scrolls by exactly one pixel.
  expect(revealOffset({ top: 701, height: 100 }, viewport)).toBe(201)
})

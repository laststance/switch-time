import { dayBounds } from '@switch-time/shared'
import { expect, test } from 'vitest'

import type { ListedDay, UndoSlot } from './correction'
import {
  untappedMergeNote,
  untappedPickNote,
  untappedUndoNote,
  type UntappedFacts,
} from './untapped'

const TZ = 'Asia/Tokyo'
const MIN = 60_000
const at = (day: string, hour: number, minute = 0) =>
  new Date(dayBounds(day, TZ).start + hour * 60 * MIN + minute * MIN)
const row = (
  id: string,
  activityId: string | null,
  startedAt: Date,
  startsRun = false,
) => ({
  id,
  userId: 'u',
  activityId,
  startedAt,
  source: 'tap' as const,
  revision: 0,
  startsRun,
  createdAt: startedAt,
})
const facts = (day: string, today: string): UntappedFacts => ({
  day,
  today,
  timeZone: TZ,
  autoExcludeUnusedDays: true,
})

test('switching a weekend detox carried into Monday to an activity names the untapped weekend it measured', () => {
  // Arrange: detox from Friday 22:00, 仕事 on Monday 9:00, viewed on Monday.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [row('w', 'work', at('2026-09-21', 9))],
    carriedOut: null,
  }

  // Act
  const note = untappedPickNote(
    list,
    { id: 'c', activityId: null },
    facts('2026-09-21', '2026-09-25'),
  )

  // Assert
  expect(note).toBe(
    'detox と活動を切り替えると、タップのない日（9月19日〜9月20日）の計測が変わることがあります',
  )
})

test('switching the day’s last detox to an activity names the untapped days after it through today', () => {
  // Arrange: 仕事 then detox from 20:00 that is still running.
  const list: ListedDay = {
    carriedIn: null,
    carriedInRunStart: null,
    rows: [
      row('w', 'work', at('2026-09-21', 9)),
      row('d', null, at('2026-09-21', 20)),
    ],
    carriedOut: null,
  }

  // Act
  const note = untappedPickNote(
    list,
    { id: 'd', activityId: null },
    facts('2026-09-21', '2026-09-24'),
  )

  // Assert
  expect(note).toBe(
    'detox と活動を切り替えると、タップのない日（9月22日〜9月24日）の計測が変わることがあります',
  )
})

test('switching the day’s last activity to detox names the untapped days the detox would run through', () => {
  // Arrange: 仕事 from 9:00 is still running.
  const list: ListedDay = {
    carriedIn: null,
    carriedInRunStart: null,
    rows: [row('w', 'work', at('2026-09-21', 9))],
    carriedOut: null,
  }

  // Act
  const note = untappedPickNote(
    list,
    { id: 'w', activityId: 'work' },
    facts('2026-09-21', '2026-09-23'),
  )

  // Assert
  expect(note).toBe(
    'detox と活動を切り替えると、タップのない日（9月22日〜9月23日）の計測が変わることがあります',
  )
})

test('switching the activity between two detox runs to detox names the days the joined run no longer reaches', () => {
  // Arrange: detox from 9/15, 仕事 at 9:00 on 9/18, a new detox run from 12:00 still running.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-15', 22)),
    carriedInRunStart: '2026-09-15',
    rows: [
      row('w', 'work', at('2026-09-18', 9)),
      row('d', null, at('2026-09-18', 12)),
    ],
    carriedOut: null,
  }

  // Act: detox on 仕事 joins both runs into one that started on 9/15 and ends its week on 9/22.
  const note = untappedPickNote(
    list,
    { id: 'w', activityId: 'work' },
    facts('2026-09-18', '2026-09-25'),
  )

  // Assert
  expect(note).toBe(
    'detox と活動を切り替えると、タップのない日（9月23日〜9月25日）の計測が変わることがあります',
  )
})

test('switching an activity to detox names the days past the next switch whose run week moves earlier', () => {
  // Arrange: 仕事 on 9/10, then a detox run from 9/12 (the next switch, not listed on the day).
  const list: ListedDay = {
    carriedIn: null,
    carriedInRunStart: null,
    rows: [row('w', 'work', at('2026-09-10', 9))],
    carriedOut: row('n', null, at('2026-09-12', 10)),
  }

  // Act: detox on 仕事 measures 9/11, and the run now starts on 9/10, so its week ends on 9/17 instead of 9/19.
  const note = untappedPickNote(
    list,
    { id: 'w', activityId: 'work' },
    facts('2026-09-10', '2026-09-25'),
  )

  // Assert
  expect(note).toBe(
    'detox と活動を切り替えると、タップのない日（9月11日〜9月19日）の計測が変わることがあります',
  )
})

test('the carried-in detox is measured from the day its run started, not the day its record did', () => {
  // Arrange: a detox run from 9/15 (week ends 9/22) was cut at 9/20; that record runs into 9/25.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-20', 0)),
    carriedInRunStart: '2026-09-15',
    rows: [row('w', 'work', at('2026-09-25', 9))],
    carriedOut: null,
  }

  // Act
  const note = untappedPickNote(
    list,
    { id: 'c', activityId: null },
    facts('2026-09-25', '2026-09-28'),
  )

  // Assert: 9/23 and 9/24 are past the run's week either way.
  expect(note).toBe(
    'detox と活動を切り替えると、タップのない日（9月21日〜9月22日）の計測が変わることがあります',
  )
})

test('switching today’s last record to detox shows no note, since no untapped day follows it yet', () => {
  // Arrange: viewing today, 仕事 from 9:00.
  const list: ListedDay = {
    carriedIn: null,
    carriedInRunStart: null,
    rows: [row('w', 'work', at('2026-09-25', 9))],
    carriedOut: null,
  }

  // Act
  const note = untappedPickNote(
    list,
    { id: 'w', activityId: 'work' },
    facts('2026-09-25', '2026-09-25'),
  )

  // Assert
  expect(note).toBeNull()
})

test('no untapped-day note shows while unused days are not excluded, since every day counts', () => {
  // Arrange: the weekend detox of the first test, with 未使用日を除外 off.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [row('w', 'work', at('2026-09-21', 9))],
    carriedOut: null,
  }

  // Act
  const note = untappedPickNote(
    list,
    { id: 'c', activityId: null },
    { ...facts('2026-09-21', '2026-09-25'), autoExcludeUnusedDays: false },
  )

  // Assert
  expect(note).toBeNull()
})

test('no untapped-day note shows before the day list or the settings have loaded', () => {
  // Arrange
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [row('w', 'work', at('2026-09-21', 9))],
    carriedOut: null,
  }

  // Act
  const withoutList = untappedPickNote(
    undefined,
    { id: 'c', activityId: null },
    facts('2026-09-21', '2026-09-25'),
  )
  const withoutFacts = untappedPickNote(
    list,
    { id: 'c', activityId: null },
    undefined,
  )

  // Assert
  expect(withoutList).toBeNull()
  expect(withoutFacts).toBeNull()
})

test('merging the day’s only record into the previous one names the viewed day, which is left without a tap', () => {
  // Arrange: 仕事 from the night before, 仕事 again at 9:00 on 9/20 (the current state).
  const list: ListedDay = {
    carriedIn: row('c', 'work', at('2026-09-19', 20)),
    carriedInRunStart: null,
    rows: [row('w', 'work', at('2026-09-20', 9))],
    carriedOut: null,
  }

  // Act
  const note = untappedMergeNote(
    list,
    { id: 'w', canMergePrevious: true, canMergeNext: false },
    facts('2026-09-20', '2026-09-25'),
  )

  // Assert
  expect(note).toBe(
    '前の記録に統合すると、タップのない日（9月20日）の計測が変わることがあります',
  )
})

test('merging a detox re-tap into a detox from an earlier day names the days its new week measured', () => {
  // Arrange: detox from 9/10 (week ends 9/17), re-tapped on 9/20 to start a new week.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-10', 22)),
    carriedInRunStart: '2026-09-10',
    rows: [row('d', null, at('2026-09-20', 8), true)],
    carriedOut: null,
  }

  // Act: the re-tap's new week is not handed to the 9/10 record, and 9/20 loses its tap.
  const note = untappedMergeNote(
    list,
    { id: 'd', canMergePrevious: true, canMergeNext: false },
    facts('2026-09-20', '2026-09-25'),
  )

  // Assert
  expect(note).toBe(
    '前の記録に統合すると、タップのない日（9月20日〜9月25日）の計測が変わることがあります',
  )
})

test('merging a detox re-tap into a detox from the same day shows no note, since the new week is handed over', () => {
  // Arrange: detox from 9/10, cut at 0:30 on 9/20, then re-tapped at 8:00 to start a new week.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-10', 22)),
    carriedInRunStart: '2026-09-10',
    rows: [
      row('p', null, at('2026-09-20', 0, 30)),
      row('d', null, at('2026-09-20', 8), true),
    ],
    carriedOut: null,
  }

  // Act
  const note = untappedMergeNote(
    list,
    { id: 'd', canMergePrevious: true, canMergeNext: false },
    facts('2026-09-20', '2026-09-25'),
  )

  // Assert
  expect(note).toBeNull()
})

test('either merge of the activity that ends a detox names the days the joined run no longer reaches', () => {
  // Arrange: detox from Friday 9/18, 仕事 on Monday 9:00, a new detox run from 20:00 still running.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [
      row('w', 'work', at('2026-09-21', 9)),
      row('d', null, at('2026-09-21', 20)),
    ],
    carriedOut: null,
  }

  // Act: without 仕事 the 20:00 detox continues the run from 9/18, whose week ends on 9/25 instead of 9/28.
  const note = untappedMergeNote(
    list,
    { id: 'w', canMergePrevious: true, canMergeNext: true },
    facts('2026-09-21', '2026-09-28'),
  )

  // Assert
  expect(note).toBe(
    '統合すると、タップのない日（9月26日〜9月28日）の計測が変わることがあります',
  )
})

test('only the merge that changes an untapped day is named on the note', () => {
  // Arrange: 仕事 from the night before, 休息 at 9:00, detox from 20:00 still running.
  const list: ListedDay = {
    carriedIn: row('c', 'work', at('2026-09-20', 22)),
    carriedInRunStart: null,
    rows: [
      row('r', 'rest', at('2026-09-21', 9)),
      row('d', null, at('2026-09-21', 20)),
    ],
    carriedOut: null,
  }

  // Act: 次の記録に統合 starts the detox at 9:00, same day; 前の記録に統合 leaves it as is. Neither changes a day.
  const restNote = untappedMergeNote(
    list,
    { id: 'r', canMergePrevious: true, canMergeNext: true },
    facts('2026-09-21', '2026-09-25'),
  )
  // Act: merging the detox into 休息 leaves no detox to measure 9/22 onwards.
  const detoxNote = untappedMergeNote(
    list,
    { id: 'd', canMergePrevious: true, canMergeNext: false },
    facts('2026-09-21', '2026-09-25'),
  )

  // Assert
  expect(restNote).toBeNull()
  expect(detoxNote).toBe(
    '前の記録に統合すると、タップのない日（9月22日〜9月25日）の計測が変わることがあります',
  )
})

test('undoing a day edit that made a record detox names the untapped days it stops measuring', () => {
  // Arrange: detox from Friday 9/18; 仕事 at 9:00 on Monday was just switched to detox.
  const day = '2026-09-21'
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [row('w', null, at(day, 9))],
    carriedOut: null,
  }
  const slot: UndoSlot = {
    kind: 'day',
    day,
    timeZone: TZ,
    rows: [{ activityId: 'work', startedAt: at(day, 9) }],
    expected: [{ id: 'w', activityId: null, startedAt: at(day, 9) }],
    carriedOutId: null,
    reselect: null,
    account: 'u',
  }

  // Act
  const note = untappedUndoNote(list, slot, facts(day, '2026-09-23'))

  // Assert
  expect(note).toBe(
    '元に戻すと、タップのない日（9月22日〜9月23日）の計測も変わることがあります',
  )
})

test('undoing a switch of the carried-in record to detox names the untapped days it stops measuring', () => {
  // Arrange: the record from Friday 9/18 22:00 was just switched from 仕事 to detox on Monday's sheet.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [row('w', 'work', at('2026-09-21', 9))],
    carriedOut: null,
  }
  const slot: UndoSlot = {
    kind: 'activity',
    day: '2026-09-21',
    id: 'c',
    to: 'work',
    revision: 1,
  }

  // Act
  const note = untappedUndoNote(list, slot, facts('2026-09-21', '2026-09-25'))

  // Assert
  expect(note).toBe(
    '元に戻すと、タップのない日（9月19日〜9月20日）の計測も変わることがあります',
  )
})

test('no undo note shows when no undo is offered', () => {
  // Arrange
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [row('w', 'work', at('2026-09-21', 9))],
    carriedOut: null,
  }

  // Act
  const note = untappedUndoNote(
    list,
    undefined,
    facts('2026-09-21', '2026-09-25'),
  )

  // Assert
  expect(note).toBeNull()
})

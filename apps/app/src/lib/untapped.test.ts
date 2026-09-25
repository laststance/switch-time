import { dayBounds } from '@switch-time/shared'
import { expect, test } from 'vitest'

import type { ListedDay, UndoSlot } from './correction'
import {
  untappedMergeNote,
  untappedPickNote,
  untappedRowNotes,
  untappedSheetNotes,
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

test('switching a carried-in activity that ends a detox run to detox counts the week of the run it joins', () => {
  // Arrange: a detox run from 9/1 ended at 仕事 on 9/5, which runs into 9/6.
  const list: ListedDay = {
    carriedIn: row('c', 'work', at('2026-09-05', 9)),
    carriedInRunStart: '2026-09-01',
    rows: [],
    carriedOut: null,
  }

  // Act
  const note = untappedPickNote(
    list,
    { id: 'c', activityId: 'work' },
    facts('2026-09-06', '2026-09-15'),
  )

  // Assert: detox there joins the run from 9/1, whose week ends on 9/8, not on 9/12.
  expect(note).toBe(
    'detox と活動を切り替えると、タップのない日（9月6日〜9月8日）の計測が変わることがあります',
  )
})

test('switching an activity that keeps a re-tap mark to detox names the days of the week it renews', () => {
  // Arrange: a detox run from 9/1; on 9/10 a re-tap (startsRun) that was later switched to 仕事.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-01', 22)),
    carriedInRunStart: '2026-09-01',
    rows: [row('w', 'work', at('2026-09-10', 9), true)],
    carriedOut: null,
  }

  // Act
  const note = untappedPickNote(
    list,
    { id: 'w', activityId: 'work' },
    facts('2026-09-10', '2026-09-20'),
  )

  // Assert: detox again renews the run from 9/10, so its week runs through 9/17.
  expect(note).toBe(
    'detox と活動を切り替えると、タップのない日（9月11日〜9月17日）の計測が変わることがあります',
  )
})

test('a clock tick that rebuilds the selected row reuses its lines while the day list is unchanged', () => {
  // Arrange: the weekend detox carried into Monday, its panel open.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [row('w', 'work', at('2026-09-21', 9))],
    carriedOut: null,
  }
  const sheetFacts = { ...facts('2026-09-21', '2026-09-25'), ready: true }
  const selected = {
    id: 'c',
    activityId: null,
    carriedIn: true,
    canMergePrevious: false,
    canMergeNext: false,
  }
  const first = untappedSheetNotes(list, undefined, sheetFacts).untappedNotes(
    selected,
  )

  // Act: the next render passes an equal row and equal facts as new objects.
  const again = untappedSheetNotes(list, undefined, {
    ...sheetFacts,
  }).untappedNotes({ ...selected })

  // Assert
  expect(again).toBe(first)
  expect(again.pick).toBe(
    'detox と活動を切り替えると、タップのない日（9月19日〜9月20日）の計測が変わることがあります',
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
    carriedInRunStart: '2026-09-19',
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
    carriedInRunStart: '2026-09-20',
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

test('the carried-in record’s panel shows the pick line but never a merge line, since it cannot merge', () => {
  // Arrange: the weekend detox carried into Monday, whose merge flags would otherwise ask.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [row('w', 'work', at('2026-09-21', 9))],
    carriedOut: null,
  }

  // Act
  const notes = untappedRowNotes(
    list,
    {
      id: 'c',
      activityId: null,
      carriedIn: true,
      canMergePrevious: true,
      canMergeNext: true,
    },
    facts('2026-09-21', '2026-09-25'),
  )

  // Assert
  expect(notes).toEqual({
    pick: 'detox と活動を切り替えると、タップのない日（9月19日〜9月20日）の計測が変わることがあります',
    merge: null,
  })
})

test('a day’s own row shows both the pick line and the merge line', () => {
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

  // Act
  const notes = untappedRowNotes(
    list,
    {
      id: 'w',
      activityId: 'work',
      carriedIn: false,
      canMergePrevious: true,
      canMergeNext: true,
    },
    facts('2026-09-21', '2026-09-28'),
  )

  // Assert
  expect(notes).toEqual({
    pick: 'detox と活動を切り替えると、タップのない日（9月26日〜9月28日）の計測が変わることがあります',
    merge:
      '統合すると、タップのない日（9月26日〜9月28日）の計測が変わることがあります',
  })
})

test('the sheet shows no untapped-day note until the stored settings are read, then shows them', () => {
  // Arrange: the carried-in record from Friday was just switched from 仕事 to detox on Monday's sheet.
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
  const carriedIn = {
    id: 'c',
    activityId: null,
    carriedIn: true,
    canMergePrevious: false,
    canMergeNext: false,
  }

  // Act
  const loading = untappedSheetNotes(list, slot, {
    ...facts('2026-09-21', '2026-09-25'),
    ready: false,
  })
  const read = untappedSheetNotes(list, slot, {
    ...facts('2026-09-21', '2026-09-25'),
    ready: true,
  })

  // Assert
  expect([loading.undoNote, loading.untappedNotes(carriedIn)]).toEqual([
    null,
    { pick: null, merge: null },
  ])
  expect([read.undoNote, read.untappedNotes(carriedIn)]).toEqual([
    '元に戻すと、タップのない日（9月19日〜9月20日）の計測も変わることがあります',
    {
      pick: 'detox と活動を切り替えると、タップのない日（9月19日〜9月20日）の計測が変わることがあります',
      merge: null,
    },
  ])
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

test('the merge note names 次の記録に統合 when it is the only merge the row allows', () => {
  // Arrange: detox from Friday 9/18, 仕事 on Monday 9:00, a new detox run from 20:00 still running; 前の記録に統合 is not offered.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [
      row('w', 'work', at('2026-09-21', 9)),
      row('d', null, at('2026-09-21', 20)),
    ],
    carriedOut: null,
  }

  // Act
  const note = untappedMergeNote(
    list,
    { id: 'w', canMergePrevious: false, canMergeNext: true },
    facts('2026-09-21', '2026-09-28'),
  )

  // Assert
  expect(note).toBe(
    '次の記録に統合すると、タップのない日（9月26日〜9月28日）の計測が変わることがあります',
  )
})

test('no merge note shows for a merge the list has no neighbour for, since the API would refuse it', () => {
  // Arrange: the account's first state ever (仕事 9:00), then detox from 20:00 still running; the flags claim both merges.
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
  const firstIntoPrevious = untappedMergeNote(
    list,
    { id: 'w', canMergePrevious: true, canMergeNext: false },
    facts('2026-09-21', '2026-09-25'),
  )
  const currentIntoNext = untappedMergeNote(
    list,
    { id: 'd', canMergePrevious: false, canMergeNext: true },
    facts('2026-09-21', '2026-09-25'),
  )

  // Assert
  expect(firstIntoPrevious).toBeNull()
  expect(currentIntoNext).toBeNull()
})

test('no merge note shows before the day list or the settings have loaded', () => {
  // Arrange: the weekend detox list whose 仕事 row both merges would change.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [
      row('w', 'work', at('2026-09-21', 9)),
      row('d', null, at('2026-09-21', 20)),
    ],
    carriedOut: null,
  }
  const work = { id: 'w', canMergePrevious: true, canMergeNext: true }

  // Act
  const withoutList = untappedMergeNote(
    undefined,
    work,
    facts('2026-09-21', '2026-09-28'),
  )
  const withoutFacts = untappedMergeNote(list, work, undefined)

  // Assert
  expect(withoutList).toBeNull()
  expect(withoutFacts).toBeNull()
})

test('no undo note shows when the undo only swaps one activity for another', () => {
  // Arrange: the carried-in record from Friday was just switched from 睡眠 to 休息 on Monday's sheet.
  const list: ListedDay = {
    carriedIn: row('c', 'rest', at('2026-09-18', 22)),
    carriedInRunStart: '2026-09-18',
    rows: [row('w', 'work', at('2026-09-21', 9))],
    carriedOut: null,
  }
  const slot: UndoSlot = {
    kind: 'activity',
    day: '2026-09-21',
    id: 'c',
    to: 'sleep',
    revision: 1,
  }

  // Act
  const note = untappedUndoNote(list, slot, facts('2026-09-21', '2026-09-25'))

  // Assert
  expect(note).toBeNull()
})

test('no undo note shows once the record the undo would restore is no longer listed', () => {
  // Arrange: the undo restores 仕事 on record 'c', but another device replaced it with detox record 'x' since.
  const list: ListedDay = {
    carriedIn: row('x', null, at('2026-09-18', 22)),
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
  expect(note).toBeNull()
})

test('a day after today shows no untapped-day note, since none of the days it could change has come yet', () => {
  // Arrange: detox tapped at 8:00 today (9/25) is still running; the sheet is opened on 9/27.
  const list: ListedDay = {
    carriedIn: row('c', null, at('2026-09-25', 8)),
    carriedInRunStart: '2026-09-25',
    rows: [],
    carriedOut: null,
  }

  // Act
  const note = untappedPickNote(
    list,
    { id: 'c', activityId: null },
    facts('2026-09-27', '2026-09-25'),
  )

  // Assert
  expect(note).toBeNull()
})

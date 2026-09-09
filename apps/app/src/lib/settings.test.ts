import { expect, test } from 'vitest'

import {
  editorRows,
  excludedRange,
  exclusionSummary,
  idleLabel,
  reorderIds,
  spareColor,
  targetHoursFromText,
} from './settings'

const activity = (
  id: string,
  name: string,
  color: string,
  position: number,
  targetHours: number | null,
  archivedAt: Date | null = null,
) => ({
  id,
  userId: 'u',
  name,
  color,
  iconKey: id,
  targetHours,
  position,
  archivedAt,
  createdAt: new Date(2026, 8, 1),
})

test('the editor lists live activities only and keeps the current state and the last activity from being archived', () => {
  // Arrange: 仕事 is the current state; 読書 was archived.
  const list = [
    activity('home', '家事', '#E0A431', 0, 1.5),
    activity('work', '仕事', '#3B7BD9', 1, 8),
    activity('rest', '休息', '#4FA877', 2, null),
    activity('book', '読書', '#2BA3B5', 3, 1, new Date(2026, 8, 8)),
  ]

  // Act
  const rows = editorRows(list, 'work')

  // Assert
  expect(
    rows.map((row) => [
      row.name,
      row.targetText,
      row.canMoveUp,
      row.canMoveDown,
      row.canArchive,
    ]),
  ).toEqual([
    ['家事', '1.5', false, true, true],
    ['仕事', '8', true, true, false],
    ['休息', '', true, false, true],
  ])
  expect(
    editorRows([activity('home', '家事', '#E0A431', 0, 1.5)], null)[0]
      ?.canArchive,
  ).toBe(false)
  expect(editorRows(undefined, null)).toEqual([])
})

test('a new activity takes the first unused palette colour and wraps when all eight are used', () => {
  // Arrange
  const six = ['#E0A431', '#3B7BD9', '#4FA877', '#6C63D6', '#E0684A', '#D8579C']
  const eight = [...six, '#2BA3B5', '#8A6A4B']

  // Act & Assert
  expect(spareColor(six)).toBe('#2BA3B5')
  expect(spareColor(eight)).toBe('#E0A431')
  expect(spareColor(['#3B7BD9'])).toBe('#E0A431')
})

test('moving an id one step swaps it with its neighbour and stays put at the ends', () => {
  // Arrange
  const ids = ['a', 'b', 'c']

  // Act & Assert
  expect(reorderIds(ids, 'c', -1)).toEqual(['a', 'c', 'b'])
  expect(reorderIds(ids, 'a', 1)).toEqual(['b', 'a', 'c'])
  expect(reorderIds(ids, 'a', -1)).toBe(ids)
  expect(reorderIds(ids, 'c', 1)).toBe(ids)
  expect(reorderIds(ids, 'zzz', 1)).toBe(ids)
})

test('the exclusion row and the idle picker read the stored threshold in hours', () => {
  // Act & Assert
  expect(idleLabel(720)).toBe('12時間')
  expect(idleLabel(90)).toBe('90分')
  expect(
    exclusionSummary({
      autoExcludeUnusedDays: true,
      idleThresholdMinutes: 720,
    }),
  ).toBe('オン · 無操作 12時間以上')
  expect(
    exclusionSummary({
      autoExcludeUnusedDays: false,
      idleThresholdMinutes: 480,
    }),
  ).toBe('オフ')
})

test('a blank target field means no target and the excluded-days window is the last year', () => {
  // Act & Assert
  expect(targetHoursFromText('  ')).toBeNull()
  expect(targetHoursFromText('1.5')).toBe(1.5)
  expect(excludedRange('2026-09-09')).toEqual({
    from: '2025-09-09',
    to: '2026-09-09',
  })
})

import { expect, test } from 'vitest'

import { hotkeyIndex, hotkeyPick, isDetoxHotkey } from './hotkeys'

test('digits pick activities by position and modifier combos are left to the browser', () => {
  // Arrange
  const press = (key: string, metaKey = false) => ({
    key,
    metaKey,
    ctrlKey: false,
    altKey: false,
  })

  // Act
  const picks = [
    press('1'),
    press('6'),
    press('0'),
    press('a'),
    press('1', true),
  ].map(hotkeyIndex)

  // Assert
  expect(picks.slice(0, 2)).toEqual([0, 5])
  expect(picks.slice(2)).toEqual([-1, NaN, -1])
})

test('the plain 0 starts detox, a modifier combo or another digit does not', () => {
  // Arrange
  const press = (
    key: string,
    held: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {},
  ) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...held })

  // Act: ⌘0 switches browser tabs, ⌃0 and ⌥0 are the browser's too
  const detox = [
    press('0'),
    press('0', { metaKey: true }),
    press('0', { ctrlKey: true }),
    press('0', { altKey: true }),
    press('1'),
  ].map(isDetoxHotkey)

  // Assert
  expect(detox).toEqual([true, false, false, false, false])
})

test('0 starts detox on the first-launch screen before its activity buttons have loaded, and the digits pick nothing yet', () => {
  // Arrange: the activity list has not answered, so the first-launch screen shows no activity button
  const activities: { id: string }[] = []
  const press = (key: string) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
  })

  // Act
  const picks = [press('0'), press('1')].map((event) =>
    hotkeyPick(event, activities),
  )

  // Assert
  expect(picks).toEqual([null, undefined])
})

test('⌘0 is left to the browser instead of starting detox', () => {
  // Arrange
  const activities = [{ id: 'chores' }, { id: 'work' }]

  // Act
  const picked = hotkeyPick(
    { key: '0', metaKey: true, ctrlKey: false, altKey: false },
    activities,
  )

  // Assert
  expect(picked).toBeUndefined()
})

test('a hotkey picks the button at its position or detox, and a held key’s repeats pick nothing', () => {
  // Arrange: the first-launch screen's three buttons
  const activities = [{ id: 'chores' }, { id: 'work' }, { id: 'rest' }]
  const press = (
    key: string,
    held: { metaKey?: boolean; repeat?: boolean } = {},
  ) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...held,
  })

  // Act
  const picks = [
    press('2'),
    press('0'),
    press('4'),
    press('a'),
    press('2', { metaKey: true }),
    press('2', { repeat: true }),
    press('0', { repeat: true }),
  ].map((event) => hotkeyPick(event, activities))

  // Assert: 2 is the second button, 0 is detox; a digit past the last button, another key, ⌘2 and repeats send nothing
  expect(picks).toEqual([
    'work',
    null,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
})

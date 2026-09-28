import { expect, test } from 'vitest'

import { dayDigest } from './day-digest'

const WORK = '11111111-1111-4111-8111-111111111111'
const REST = '22222222-2222-4222-8222-222222222222'
const first = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  activityId: WORK,
  startedAt: new Date('2026-09-28T00:00:00.000Z'),
  revision: 2,
}
const second = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  activityId: null,
  startedAt: new Date('2026-09-28T01:00:00.000Z'),
  revision: 0,
}

test('a day digests to its row count and one hash the app and the API both compute the same', () => {
  // Act
  const digests = [dayDigest([]), dayDigest([first, second])]

  // Assert
  expect(digests).toEqual(['0:bdcb81aee8d83', '2:19ff5e710ffb5f'])
})

test('a busy day changed and changed back (pick 娯楽, then 仕事 again) digests differently, since the row’s revision moved on', () => {
  // Arrange: the same activity again, two writes later
  const changedBack = { ...first, revision: 4 }

  // Act
  const digest = dayDigest([changedBack, second])

  // Assert
  expect(digest).not.toBe(dayDigest([first, second]))
})

test('a busy day digests differently once another device changed a row’s activity, start or order', () => {
  // Arrange
  const picked = { ...first, activityId: REST }
  const moved = { ...first, startedAt: new Date('2026-09-28T00:15:00.000Z') }

  // Act
  const digests = [
    dayDigest([picked, second]),
    dayDigest([moved, second]),
    dayDigest([second, first]),
  ]

  // Assert
  expect(new Set([...digests, dayDigest([first, second])]).size).toBe(4)
})

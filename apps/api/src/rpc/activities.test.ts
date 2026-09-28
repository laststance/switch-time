import { expect, test } from 'vitest'

import { db } from '../db/client'
import { activities } from '../db/schema/app'
import { signedIn } from '../test/client'

// Live activities `seedUser` gives every new account.
const SEEDED = 6

/**
 * Tops the account's live set up to `total` with rows written straight to the table, past the API, so a test reaches the cap
 * without a hundred round trips. Positions continue after the seeded six.
 */
const fillLiveActivities = async (userId: string, total: number) =>
  db.insert(activities).values(
    Array.from({ length: total - SEEDED }, (_, index) => ({
      userId,
      name: `項目${index}`,
      color: '#E0A431',
      iconKey: 'home',
      position: SEEDED + index,
    })),
  )

const NEW_ACTIVITY = {
  name: '読書',
  color: '#E0A431',
  iconKey: 'book',
  targetHours: null,
} as const

test('adding a 101st live activity is refused, so the grid can still be reordered', async () => {
  // Arrange
  const api = await signedIn('cap-create@example.com')
  const { id: userId } = await api.me()
  await fillLiveActivities(userId, 100)

  // Act
  const adding = api.activities.create(NEW_ACTIVITY)

  // Assert
  await expect(adding).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'too-many-activities' },
  })
  const live = (await api.activities.list()).filter(
    (row) => row.archivedAt === null,
  )
  expect(live).toHaveLength(100)
})

test('the 100th live activity can still be added', async () => {
  // Arrange
  const api = await signedIn('cap-create-last@example.com')
  const { id: userId } = await api.me()
  await fillLiveActivities(userId, 99)

  // Act
  const created = await api.activities.create(NEW_ACTIVITY)

  // Assert
  expect(created).toMatchObject({ name: '読書', position: 99 })
})

test('bringing back an archived activity into a full grid is refused, and it stays archived', async () => {
  // Arrange: 休息 archived first, then the live set filled to the cap
  const api = await signedIn('cap-unarchive@example.com')
  const { id: userId } = await api.me()
  const rest = (await api.activities.list()).find((row) => row.name === '休息')
  if (!rest) throw new Error('no 休息')
  await api.activities.archive({ id: rest.id })
  await fillLiveActivities(userId, 101)

  // Act
  const bringingBack = api.activities.unarchive({ id: rest.id })

  // Assert
  await expect(bringingBack).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'too-many-activities' },
  })
  const after = (await api.activities.list()).find((row) => row.id === rest.id)
  expect(after?.archivedAt).not.toBeNull()
})

test('an unarchive of an activity that is already live answers it even in a full grid', async () => {
  // Arrange
  const api = await signedIn('cap-unarchive-live@example.com')
  const { id: userId } = await api.me()
  const work = (await api.activities.list()).find((row) => row.name === '仕事')
  if (!work) throw new Error('no 仕事')
  await fillLiveActivities(userId, 100)

  // Act
  const again = await api.activities.unarchive({ id: work.id })

  // Assert
  expect(again).toMatchObject({ id: work.id, archivedAt: null })
})

test('archiving the running activity is refused with a reason the 活動項目 sheet can say', async () => {
  // Arrange
  const api = await signedIn('archive-in-use@example.com')
  const work = (await api.activities.list()).find((row) => row.name === '仕事')
  if (!work) throw new Error('no 仕事')
  await api.switches.switchTo({ activityId: work.id })

  // Act
  const archiving = api.activities.archive({ id: work.id })

  // Assert
  await expect(archiving).rejects.toMatchObject({
    code: 'CONFLICT',
    data: { reason: 'in-use' },
  })
})

import { eq } from 'drizzle-orm'
import { expect, test } from 'vitest'

import { signedIn } from '../test/client'

import { db } from './client'
import { switches } from './schema/app'

// The database's own guard, below the routes' ownership checks: these writes bypass every route on purpose.

test('the database refuses a switch that names another account’s activity, whatever code writes it', async () => {
  // Arrange
  const owner = await signedIn('fk-owner@example.com')
  const stranger = await signedIn('fk-stranger@example.com')
  const { id: ownerId } = await owner.me()
  const [strangersActivity] = await stranger.activities.list()
  if (!strangersActivity) throw new Error('the stranger has no activity')

  // Act
  const insert = db.insert(switches).values({
    userId: ownerId,
    activityId: strangersActivity.id,
    startedAt: new Date(),
  })

  // Assert
  await expect(insert).rejects.toMatchObject({
    cause: { code: '23503', constraint: 'switches_activity_user_fkey' },
  })
})

test('the database refuses moving a switch onto another account’s activity', async () => {
  // Arrange
  const owner = await signedIn('fk-move-owner@example.com')
  const stranger = await signedIn('fk-move-stranger@example.com')
  const [ownActivity] = await owner.activities.list()
  const [strangersActivity] = await stranger.activities.list()
  if (!ownActivity || !strangersActivity)
    throw new Error('an account has no activity')
  const running = await owner.switches.switchTo({ activityId: ownActivity.id })

  // Act
  const update = db
    .update(switches)
    .set({ activityId: strangersActivity.id })
    .where(eq(switches.id, running.id))

  // Assert
  await expect(update).rejects.toMatchObject({
    cause: { code: '23503', constraint: 'switches_activity_user_fkey' },
  })
})

test('a detox switch, which names no activity, is still stored', async () => {
  // Arrange
  const owner = await signedIn('fk-detox@example.com')
  const { id: ownerId } = await owner.me()

  // Act
  const inserted = await db
    .insert(switches)
    .values({ userId: ownerId, activityId: null, startedAt: new Date() })
    .returning()

  // Assert
  expect(inserted).toMatchObject([{ userId: ownerId, activityId: null }])
})

import { eq, inArray } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { z } from 'zod'

import { app } from './app'
import { db } from './db/client'
import { activities } from './db/schema/app'
import { user } from './db/schema/auth'
import { cookieJar, rpc, signIn, signUp } from './test/client'

const signUpAnswer = z.object({
  token: z.string().nullable(),
  user: z.record(z.string(), z.unknown()),
})

/** The parts of a sign-up answer a caller can see, minus the values that differ per request (ids, timestamps). */
const visible = async (response: Response) => {
  const body = signUpAnswer.parse(await response.clone().json())
  return {
    status: response.status,
    token: body.token,
    userKeys: Object.keys(body.user).sort(),
    cookie: cookieJar(response),
  }
}

test('sign-up creates the account without signing it in', async () => {
  // Act
  const response = await signUp('fresh@example.com')

  // Assert
  expect(await visible(response)).toMatchObject({
    status: 200,
    token: null,
  })
  expect(cookieJar(response)).not.toMatch(/better-auth\.session_token=/)
})

test('a sign-up for an address that already has an account answers exactly like a new one', async () => {
  // Arrange
  await signUp('taken@example.com')

  // Act
  const duplicate = await visible(
    await signUp('taken@example.com', 'another password entirely'),
  )
  const fresh = await visible(await signUp('unused@example.com'))

  // Assert
  expect(duplicate).toEqual(fresh)
  expect(duplicate.status).toBe(200)
})

test('a sign-up for an address that already has an account answers with what was just sent, not with the stored account', async () => {
  // Arrange
  const answerUser = z.object({
    user: z.object({
      id: z.string(),
      name: z.string(),
      emailVerified: z.boolean(),
      createdAt: z.string(),
    }),
  })
  const stored = answerUser.parse(
    await (await signUp('stored@example.com')).json(),
  ).user

  // Act
  const response = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Someone Else',
      email: 'stored@example.com',
      password: 'another password entirely',
    }),
  })
  const answer = answerUser.parse(await response.json())

  // Assert: the stored id, name ('Raphtalia') or creation time would tell that the address was taken.
  expect(answer.user.id).not.toBe(stored.id)
  expect(answer.user.name).toBe('Someone Else')
  expect(answer.user.emailVerified).toBe(false)
  expect(Date.parse(answer.user.createdAt)).toBeGreaterThan(
    Date.parse(stored.createdAt),
  )
})

test('a second sign-up for an address creates no second account and no second set of activities', async () => {
  // Arrange
  const accountIds = async () =>
    (
      await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, 'once@example.com'))
    ).map((row) => row.id)
  const activityCount = async (userIds: string[]) =>
    (
      await db
        .select({ id: activities.id })
        .from(activities)
        .where(inArray(activities.userId, userIds))
    ).length
  await signUp('once@example.com')
  const before = await accountIds()
  const seeded = await activityCount(before)

  // Act
  await signUp('once@example.com', 'another password entirely')

  // Assert
  expect(before).toHaveLength(1)
  expect(await accountIds()).toEqual(before)
  expect(await activityCount(before)).toBe(seeded)
})

test('a second sign-up leaves the existing password in place', async () => {
  // Arrange
  await signUp('keeper@example.com')
  await signUp('keeper@example.com', 'another password entirely')

  // Act
  const original = await signIn('keeper@example.com')
  const intruder = await signIn(
    'keeper@example.com',
    'another password entirely',
  )

  // Assert
  expect(original.status).toBe(200)
  expect(cookieJar(original)).toMatch(/better-auth\.session_token=\S+/)
  expect(intruder.status).toBe(401)
})

test('a new account signs in and an authed procedure returns that user', async () => {
  // Arrange
  await signUp('me@example.com')
  const cookie = cookieJar(await signIn('me@example.com'))

  // Act
  const me = await rpc(cookie).me()

  // Assert
  expect(me.email).toBe('me@example.com')
  expect(me.name).toBe('Raphtalia')
})

test('an anonymous call to an authed procedure is rejected with UNAUTHORIZED', async () => {
  // Act + Assert
  await expect(rpc().me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
})

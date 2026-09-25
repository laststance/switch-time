import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'vitest'

import {
  confirmTap,
  startTapSession,
  isLastTap,
  OPTIMISTIC_ID,
  placeTap,
  rollBackTap,
  SWITCH_TO_SCOPE,
} from './optimistic-switch'
import type { CurrentSwitch } from './orpc'

const CURRENT = ['switches', 'current']

// A row as the server stores it: `switches.current` adds `runStartDay`, `switchTo` answers without it.
const serverRow = (id: string, activityId: string | null): CurrentSwitch => ({
  id,
  userId: 'user-1',
  activityId,
  startedAt: new Date('2026-09-25T03:00:00.000Z'),
  source: 'tap',
  revision: 0,
  startsRun: false,
  createdAt: new Date('2026-09-25T03:00:00.000Z'),
  runStartDay: null,
})

// One tap, run through TanStack's own mutation cache with the callbacks useSwitchTo gives it; the returned `answer` settles it.
function tap(client: QueryClient, activityId: string | null) {
  const answer = Promise.withResolvers<CurrentSwitch>()
  const lastTapWhenSettled: boolean[] = []
  const request = { sent: false }
  const settled = client
    .getMutationCache()
    .build(client, {
      scope: { id: SWITCH_TO_SCOPE },
      mutationFn: async () => {
        request.sent = true
        return answer.promise
      },
      onMutate: () => placeTap(client, CURRENT, activityId),
      onSuccess: (row: CurrentSwitch, _input, context) => {
        if (context) confirmTap(context, row)
      },
      onError: (_error, _input, context) => {
        if (context) rollBackTap(client, CURRENT, context)
      },
      onSettled: (_row, _error, _input, context) => {
        lastTapWhenSettled.push(isLastTap(client, context))
      },
    })
    .execute({ activityId })
    .catch(() => undefined)
  return { answer, settled, lastTapWhenSettled, request }
}

// Lets the mutation cache run the callbacks due so far (onMutate, the next tap's turn).
const flush = async (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

const shownActivity = (client: QueryClient) =>
  client.getQueryData<CurrentSwitch | null>(CURRENT)?.activityId

test('a tap shows its state at once, and a refused tap brings back the switch the server had', async () => {
  // Arrange: 仕事 runs on the server
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-work', 'work'))

  // Act
  const rest = tap(client, 'rest')
  await flush()
  const shownWhilePending = client.getQueryData<CurrentSwitch>(CURRENT)
  rest.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await rest.settled

  // Assert
  expect(shownWhilePending).toMatchObject({
    id: OPTIMISTIC_ID,
    activityId: 'rest',
  })
  expect(client.getQueryData(CURRENT)).toEqual(serverRow('row-work', 'work'))
})

test('a refused first tap on a new account brings back the first-launch state', async () => {
  // Arrange: no switch yet
  const client = new QueryClient()
  client.setQueryData(CURRENT, null)

  // Act
  const detox = tap(client, null)
  await flush()
  detox.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await detox.settled

  // Assert
  expect(client.getQueryData(CURRENT)).toBeNull()
})

test('a tap refused while a later tap waits leaves the later tap on screen instead of flashing the older state', async () => {
  // Arrange: a new account taps 仕事, then 休息 while 仕事 is still unanswered
  const client = new QueryClient()
  client.setQueryData(CURRENT, null)
  const work = tap(client, 'work')
  await flush()
  const rest = tap(client, 'rest')
  await flush()

  // Act
  work.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await work.settled

  // Assert: 休息 stays shown, and the refused tap does not refetch over it
  expect(shownActivity(client)).toBe('rest')
  expect(work.lastTapWhenSettled).toEqual([false])
  rest.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await rest.settled
})

test('two queued taps both refused fall back to the state before the first, never to the first tap’s placeholder', async () => {
  // Arrange: a new account taps 仕事, then 休息 while 仕事 is still unanswered
  const client = new QueryClient()
  client.setQueryData(CURRENT, null)
  const work = tap(client, 'work')
  await flush()
  const rest = tap(client, 'rest')
  await flush()

  // Act: an outage refuses both
  work.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await work.settled
  await flush()
  rest.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await rest.settled

  // Assert: the first-launch state, and only the last tap refetches
  expect(client.getQueryData(CURRENT)).toBeNull()
  expect(rest.lastTapWhenSettled).toEqual([true])
})

test('a tap refused after an earlier queued tap was accepted falls back to the accepted switch', async () => {
  // Arrange: 家事 runs; 仕事 then 休息 are tapped
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-chores', 'chores'))
  const work = tap(client, 'work')
  await flush()
  const rest = tap(client, 'rest')
  await flush()

  // Act: the server takes 仕事, then refuses 休息
  work.answer.resolve(serverRow('row-work', 'work'))
  await work.settled
  await flush()
  rest.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await rest.settled

  // Assert: 仕事, as the server recorded it (its run start comes with the refetch)
  expect(client.getQueryData(CURRENT)).toEqual(serverRow('row-work', 'work'))
})

test('a new burst that starts on an accepted tap’s placeholder falls back to that accepted switch', async () => {
  // Arrange: 仕事 was accepted, and its refetch has not landed, so its placeholder is still shown
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-chores', 'chores'))
  const work = tap(client, 'work')
  await flush()
  work.answer.resolve(serverRow('row-work', 'work'))
  await work.settled

  // Act: a tap on 休息 is refused
  const rest = tap(client, 'rest')
  await flush()
  rest.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await rest.settled

  // Assert: 仕事 from the server, not the placeholder and not 家事
  expect(client.getQueryData(CURRENT)).toEqual(serverRow('row-work', 'work'))
})

test('a lone accepted tap refetches the day and stats once it lands', async () => {
  // Arrange: 仕事 runs on the server
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-work', 'work'))

  // Act: 休息 is tapped and accepted
  const rest = tap(client, 'rest')
  await flush()
  rest.answer.resolve(serverRow('row-rest', 'rest'))
  await rest.settled

  // Assert: the only tap of its burst refetches, and 休息 stays shown until the refetch
  expect(rest.lastTapWhenSettled).toEqual([true])
  expect(shownActivity(client)).toBe('rest')
})

test('an accepted tap with a later tap still queued leaves the refetch to the later tap, so the later pick is not wiped', async () => {
  // Arrange: 家事 runs; 仕事 then 休息 are tapped
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-chores', 'chores'))
  const work = tap(client, 'work')
  await flush()
  const rest = tap(client, 'rest')
  await flush()

  // Act: the server takes 仕事 while 休息 waits
  work.answer.resolve(serverRow('row-work', 'work'))
  await work.settled

  // Assert: 仕事 does not refetch, and 休息 stays shown
  expect(work.lastTapWhenSettled).toEqual([false])
  expect(shownActivity(client)).toBe('rest')

  // Act: the server takes 休息 too
  await flush()
  rest.answer.resolve(serverRow('row-rest', 'rest'))
  await rest.settled

  // Assert: the last tap of the burst refetches
  expect(rest.lastTapWhenSettled).toEqual([true])
})

test('a refused tap whose row a refetch already replaced leaves the refetched switch alone', async () => {
  // Arrange: 休息 is tapped over 仕事, then a refetch brings the server's 睡眠 (another device) before the answer
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-work', 'work'))
  const rest = tap(client, 'rest')
  await flush()
  client.setQueryData(CURRENT, serverRow('row-sleep', 'sleep'))

  // Act
  rest.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await rest.settled

  // Assert
  expect(client.getQueryData(CURRENT)).toEqual(serverRow('row-sleep', 'sleep'))
})

test('a tap of a signed-out account answered after the next account signs in never becomes what that account falls back to', async () => {
  // Arrange: account X taps 休息 over 仕事 and signs out before the answer; account Y signs in with 睡眠 running and taps 家事
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-x-work', 'work'))
  const lateTap = tap(client, 'rest')
  await flush()
  client.clear()
  startTapSession(client)
  client.setQueryData(CURRENT, serverRow('row-y-sleep', 'sleep'))
  const chores = tap(client, 'chores')
  await flush()

  // Act: X's tap is accepted late, then Y's tap is refused
  lateTap.answer.resolve(serverRow('row-x-rest', 'rest'))
  await lateTap.settled
  chores.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await chores.settled

  // Assert: Y's own 睡眠, never X's 休息
  expect(client.getQueryData(CURRENT)).toEqual(
    serverRow('row-y-sleep', 'sleep'),
  )
})

test('a tap of a signed-out account answered late does not refetch over the next account’s pick', async () => {
  // Arrange: account X taps 休息 and signs out before the answer; account Y signs in with 睡眠 running and taps 家事
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-x-work', 'work'))
  const lateTap = tap(client, 'rest')
  await flush()
  client.clear()
  startTapSession(client)
  client.setQueryData(CURRENT, serverRow('row-y-sleep', 'sleep'))
  const chores = tap(client, 'chores')
  await flush()

  // Act: X's tap is accepted while Y's is still unanswered
  lateTap.answer.resolve(serverRow('row-x-rest', 'rest'))
  await lateTap.settled

  // Assert: X's tap leaves the refetch to Y's, and Y's 家事 stays shown
  expect(lateTap.lastTapWhenSettled).toEqual([false])
  expect(shownActivity(client)).toBe('chores')
  chores.answer.resolve(serverRow('row-y-chores', 'chores'))
  await chores.settled
  expect(chores.lastTapWhenSettled).toEqual([true])
})

test('after another tab signs in as someone else, a refused tap queued behind the old account’s tap falls back to the new account’s switch', async () => {
  // Arrange: account X taps 休息; before the answer another tab signs in as Y, whose 睡眠 this tab reads, and Y's 家事 queues behind X's tap
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-x-work', 'work'))
  const oldTap = tap(client, 'rest')
  await flush()
  await client.resetQueries()
  startTapSession(client)
  client.setQueryData(CURRENT, serverRow('row-y-sleep', 'sleep'))
  const chores = tap(client, 'chores')
  await flush()

  // Act: an outage refuses both
  oldTap.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await oldTap.settled
  await flush()
  chores.answer.reject(new Error('INTERNAL_SERVER_ERROR'))
  await chores.settled

  // Assert: Y's own 睡眠, never X's 仕事, and only Y's tap refetches
  expect(client.getQueryData(CURRENT)).toEqual(
    serverRow('row-y-sleep', 'sleep'),
  )
  expect(oldTap.lastTapWhenSettled).toEqual([false])
  expect(chores.lastTapWhenSettled).toEqual([true])
})

test('after another tab signs in as someone else, the old account’s taps still queued are never sent', async () => {
  // Arrange: account X taps 休息, then 仕事 while 休息 is still unanswered; another tab signs in as Y before the answer
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-x-chores', 'chores'))
  const running = tap(client, 'rest')
  await flush()
  const queued = tap(client, 'work')
  await flush()
  await client.resetQueries()
  startTapSession(client)
  client.setQueryData(CURRENT, serverRow('row-y-sleep', 'sleep'))

  // Act: X's running tap is answered, which would hand the scope to the queued one
  running.answer.resolve(serverRow('row-x-rest', 'rest'))
  await running.settled
  await flush()

  // Assert: X's 仕事 never goes out with Y's session, and Y's 睡眠 stays shown
  expect(queued.request.sent).toBe(false)
  expect(client.getQueryData(CURRENT)).toEqual(
    serverRow('row-y-sleep', 'sleep'),
  )
})

test('after another tab signs in as someone else, the old account’s tap answered before the new account taps still refetches', async () => {
  // Arrange: account X taps detox; before the answer another tab signs in as Y (the shared cookie now sends the tap as Y's)
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-x-work', 'work'))
  const oldTap = tap(client, null)
  await flush()
  await client.resetQueries()
  startTapSession(client)
  client.setQueryData(CURRENT, serverRow('row-y-sleep', 'sleep'))

  // Act: the tap is stored on Y's account after the reset's own read came back
  oldTap.answer.resolve(serverRow('row-y-detox', null))
  await oldTap.settled

  // Assert: with no tap of Y's for it to land over, its refetch brings the detox Y's account now runs
  expect(oldTap.lastTapWhenSettled).toEqual([true])
})

test('a tap made while the last tap still waits for the day list falls back to the switch that tap’s refetch brought, run start included', async () => {
  // Arrange: detox is tapped over 仕事; once accepted, its refetch brings the detox row with its run start, then waits for the day list
  const client = new QueryClient()
  client.setQueryData(CURRENT, serverRow('row-work', 'work'))
  const refetchedDetox = {
    ...serverRow('row-detox', null),
    runStartDay: '2026-09-24',
  }
  const dayList = Promise.withResolvers<void>()
  const detox = client
    .getMutationCache()
    .build(client, {
      scope: { id: SWITCH_TO_SCOPE },
      mutationFn: async () => serverRow('row-detox', null),
      onMutate: () => placeTap(client, CURRENT, null),
      onSuccess: (row: CurrentSwitch, _input, context) => {
        if (context) confirmTap(context, row)
      },
      onSettled: async () => {
        client.setQueryData(CURRENT, refetchedDetox)
        await dayList.promise
      },
    })
    .execute({ activityId: null })
  await flush()
  const chores = tap(client, 'chores')
  await flush()

  // Act: the day list lands, then 家事 is refused
  dayList.resolve()
  await detox
  chores.answer.reject(new Error('TOO_MANY_REQUESTS'))
  await chores.settled

  // Assert: the refetched detox with its run start, so its notices stay
  expect(client.getQueryData(CURRENT)).toEqual(refetchedDetox)
})

import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'vitest'

import {
  confirmTap,
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
  const settled = client
    .getMutationCache()
    .build(client, {
      scope: { id: SWITCH_TO_SCOPE },
      mutationFn: async () => answer.promise,
      onMutate: () => placeTap(client, CURRENT, activityId),
      onSuccess: (row: CurrentSwitch) => confirmTap(client, row),
      onError: (_error, _input, context) => {
        if (context) rollBackTap(client, CURRENT, context)
      },
      onSettled: () => {
        lastTapWhenSettled.push(isLastTap(client))
      },
    })
    .execute({ activityId })
    .catch(() => undefined)
  return { answer, settled, lastTapWhenSettled }
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

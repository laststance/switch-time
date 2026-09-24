import { expect, test, type Page } from '@playwright/test'

import { apiAs, signUp } from './helpers'

// The API seeds Asia/Tokyo, so the fixture is written in that zone (fixed +09:00, no DST) without importing the shared package.
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
    new Date(),
  )
const shift = (day: string, n: number) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10)
const at = (day: string, hour: number) =>
  new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+09:00`)
const idOf = (list: { id: string; name: string }[], name: string) => {
  const activity = list.find((row) => row.name === name)
  if (!activity) throw new Error(`no activity named ${name}`)
  return activity.id
}

test('undo restores the row that was merged away', async ({ page }) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00, opened the way History links a day.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  await page.goto(`/correction?day=${yesterday}`)
  await expect(
    page.getByRole('dialog', { name: /の記録を訂正$/ }),
  ).toBeVisible()
  const rest = page.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
  await expect(rest).toBeVisible()

  // Act: merge 休息 into 仕事, then undo.
  await rest.click()
  await page.getByRole('button', { name: '前の記録に統合' }).click()
  await expect(
    page.getByRole('button', { name: '仕事 9:00 – 18:00 9h 00m' }),
  ).toBeVisible()
  await expect(rest).toHaveCount(0)
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert: the merged row is back with its old span, and there is nothing further to undo.
  await expect(rest).toBeVisible()
  await expect(
    page.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('merging into the next record hands the span to the next row, and undo brings the row back', async ({
  page,
}) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00 (today's first-launch tap closes 娯楽 at 24:00).
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  await page.goto(`/correction?day=${yesterday}`)
  const rest = page.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
  await expect(rest).toBeVisible()

  // Act: merge 休息 into 娯楽, then undo.
  await rest.click()
  await page.getByRole('button', { name: '次の記録に統合' }).click()
  await expect(
    page.getByRole('button', { name: '娯楽 12:00 – 24:00 12h 00m' }),
  ).toBeVisible()
  await expect(rest).toHaveCount(0)
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert: 休息 is back with its old span and 娯楽 starts at 18:00 again.
  await expect(rest).toBeVisible()
  await expect(
    page.getByRole('button', { name: '娯楽 18:00 – 24:00 6h 00m' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('undo brings back a row merged into the record of an archived activity', async ({
  page,
}) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00, then 休息 archived (today's first-launch tap 家事 is the current state).
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  await api.activities.archive({ id: idOf(list, '休息') })
  await page.goto(`/correction?day=${yesterday}`)
  const work = page.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' })
  await work.click()
  await page.getByRole('button', { name: '次の記録に統合' }).click()
  await expect(
    page.getByRole('button', { name: '休息 9:00 – 18:00 9h 00m' }),
  ).toBeVisible()
  await expect(work).toHaveCount(0)

  // Act
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert: 仕事 is back and the archived 休息 starts at 12:00 again, with nothing further to undo
  await expect(work).toBeVisible()
  await expect(
    page.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('undo after a merge and then a 15-minute move takes back only the move', async ({
  page,
}) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00, with 休息 merged into 娯楽 through the sheet.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  await page.goto(`/correction?day=${yesterday}`)
  const rest = page.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
  await rest.click()
  await page.getByRole('button', { name: '次の記録に統合' }).click()
  const merged = page.getByRole('button', {
    name: '娯楽 12:00 – 24:00 12h 00m',
  })
  await expect(merged).toBeVisible()

  // Act: move 娯楽 15 minutes earlier, then undo.
  await merged.click()
  await page.getByRole('button', { name: '15分早める' }).click()
  await expect(
    page.getByRole('button', { name: '娯楽 11:45 – 24:00 12h 15m' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert: 娯楽 starts at 12:00 again and 休息 stays merged away.
  await expect(merged).toBeVisible()
  await expect(rest).toHaveCount(0)
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('undo turns a changed activity back', async ({ page }) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, with 仕事 turned into 家事 through the picker.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
    ],
  })
  await page.goto(`/correction?day=${yesterday}`)
  const work = page.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' })
  await work.click()
  await page.getByRole('radio', { name: '家事' }).click()
  const chore = page.getByRole('button', { name: '家事 9:00 – 12:00 3h 00m' })
  await expect(chore).toBeVisible()

  // Act
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert
  await expect(work).toBeVisible()
  await expect(chore).toHaveCount(0)
})

test('undo is refused once another device added a switch to the day, and that switch survives', async ({
  page,
}) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00, with 休息 merged into 仕事 through the sheet.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  await page.goto(`/correction?day=${yesterday}`)
  await page.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' }).click()
  await page.getByRole('button', { name: '前の記録に統合' }).click()
  await expect(
    page.getByRole('button', { name: '仕事 9:00 – 18:00 9h 00m' }),
  ).toBeVisible()
  // Another device splits 仕事 at 10:00, behind the sheet's back.
  const [work] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!work) throw new Error('no 仕事 row')
  await api.switches.splitAt({ id: work.id, at: at(yesterday, 10) })

  // Act
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert: the other device's row is still there, 休息 did not come back, and there is nothing left to undo.
  await expect(
    page.getByRole('button', { name: '仕事 10:00 – 18:00 8h 00m' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('an edit made on a list another device has since changed is refused, and the sheet shows that device’s change', async ({
  page,
}) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00, listed by the sheet.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  await page.goto(`/correction?day=${yesterday}`)
  const staleRest = page.getByRole('button', {
    name: '休息 12:00 – 18:00 6h 00m',
  })
  await expect(staleRest).toBeVisible()
  // Another device moves 娯楽 15 minutes earlier; the sheet still lists 18:00.
  const [, , leisure] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!leisure) throw new Error('no 娯楽 row')
  await api.switches.moveStart({ id: leisure.id, deltaMinutes: -15 })

  // Act: merge the stale 休息 into 仕事.
  await staleRest.click()
  await page.getByRole('button', { name: '前の記録に統合' }).click()

  // Assert: the merge did not land, the sheet reads the moved 娯楽, and nothing was armed to undo.
  await expect(
    page.getByRole('button', { name: '休息 12:00 – 17:45 5h 45m' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('undo joins a split row back into one', async ({ page }) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, with 仕事 split at 10:30.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
    ],
  })
  await page.goto(`/correction?day=${yesterday}`)
  const work = page.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' })
  await work.click()
  await page.getByRole('button', { name: '半分で分割' }).click()
  const secondHalf = page.getByRole('button', {
    name: '仕事 10:30 – 12:00 1h 30m',
  })
  await expect(secondHalf).toBeVisible()

  // Act
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert
  await expect(work).toBeVisible()
  await expect(secondHalf).toHaveCount(0)
})

test('an edit still landing after its sheet closed holds the next sheet until it lands', async ({
  page,
}) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00; the API applies a merge into the next record but its answer is held back.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  const answer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/mergeIntoNext', async (route) => {
    const response = await route.fetch()
    await answer.promise
    await route.fulfill({ response })
  })
  await page.goto(`/correction?day=${yesterday}`)
  await page.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' }).click()
  await page.getByRole('button', { name: '次の記録に統合' }).click()

  // Act: close the sheet with the merge in flight, then open today's from Home and select 家事.
  await page.getByRole('button', { name: '完了' }).click()
  await page.getByRole('link', { name: '訂正' }).click()
  await page
    .getByRole('dialog', { name: '今日の記録を訂正' })
    .getByRole('button', { name: /^家事 / })
    .click()

  // Assert: 家事 could merge into yesterday's 娯楽, but only once the held answer has landed.
  const mergePrevious = page.getByRole('button', { name: '前の記録に統合' })
  await expect(mergePrevious).toBeDisabled()
  answer.resolve()
  await expect(mergePrevious).toBeEnabled()
})

test('the last row of a past day cannot merge into the next day’s first switch', async ({
  page,
}) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00; today's first-launch tap is the record after 娯楽.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  await page.goto(`/correction?day=${yesterday}`)
  const fun = page.getByRole('button', { name: '娯楽 18:00 – 24:00 6h 00m' })
  await expect(fun).toBeVisible()

  // Act
  await fun.click()

  // Assert: 「元に戻す」 rewrites yesterday only and would drop today's switch, so only the backward merge is offered.
  // Enabled first, so 次の記録に統合 is disabled by its own flag rather than by a fetch in flight.
  await expect(
    page.getByRole('button', { name: '前の記録に統合' }),
  ).toBeEnabled()
  await expect(
    page.getByRole('button', { name: '次の記録に統合' }),
  ).toBeDisabled()
})

test('the two merge buttons share a line and 半分で分割 spans the full width below them', async ({
  page,
}) => {
  // Arrange: a wide window, so the sheet is the 560 px dialog; yesterday's 仕事 9:00 stays editable whatever the clock says.
  await page.setViewportSize({ width: 1024, height: 860 })
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) }],
  })
  await page.goto(`/correction?day=${yesterday}`)
  const work = page.getByRole('button', { name: '仕事 9:00 – 24:00 15h 00m' })
  await expect(work).toBeVisible()

  // Act
  await work.click()
  const split = page.getByRole('button', { name: '半分で分割' })
  await expect(split).toBeVisible()

  // Assert: two 240 px halves 8 px apart, then one 488 px button 8 px below (flex-1 on it would collapse it to its text).
  const [previousBox, nextBox, splitBox] = await Promise.all([
    page.getByRole('button', { name: '前の記録に統合' }).boundingBox(),
    page.getByRole('button', { name: '次の記録に統合' }).boundingBox(),
    split.boundingBox(),
  ])
  if (!previousBox || !nextBox || !splitBox)
    throw new Error('an action button has no box')
  expect(previousBox).toMatchObject({ width: 240, height: 44 })
  expect(nextBox).toMatchObject({
    x: previousBox.x + 248,
    y: previousBox.y,
    width: 240,
    height: 44,
  })
  expect(splitBox).toMatchObject({
    x: previousBox.x,
    y: previousBox.y + 52,
    width: 488,
    height: 44,
  })
})

test('on a phone-width screen the two merge buttons still share a line at equal width, with 半分で分割 full width below', async ({
  page,
}) => {
  // Arrange: a phone-width window, so the sheet fills the screen; yesterday's 仕事 9:00 stays editable whatever the clock says.
  await page.setViewportSize({ width: 390, height: 844 })
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) }],
  })
  await page.goto(`/correction?day=${yesterday}`)
  const work = page.getByRole('button', { name: '仕事 9:00 – 24:00 15h 00m' })
  await expect(work).toBeVisible()

  // Act
  await work.click()
  const split = page.getByRole('button', { name: '半分で分割' })
  await expect(split).toBeVisible()

  // Assert: two 156 px halves 8 px apart, then one 320 px button 8 px below.
  const [previousBox, nextBox, splitBox] = await Promise.all([
    page.getByRole('button', { name: '前の記録に統合' }).boundingBox(),
    page.getByRole('button', { name: '次の記録に統合' }).boundingBox(),
    split.boundingBox(),
  ])
  if (!previousBox || !nextBox || !splitBox)
    throw new Error('an action button has no box')
  expect(previousBox).toMatchObject({ width: 156, height: 44 })
  expect(nextBox).toMatchObject({
    x: previousBox.x + 164,
    y: previousBox.y,
    width: 156,
    height: 44,
  })
  expect(splitBox).toMatchObject({
    x: previousBox.x,
    y: previousBox.y + 52,
    width: 320,
    height: 44,
  })
})

test('splitting the current state shows on Home without a reload', async ({
  page,
}) => {
  // Between 0:00 and 0:02 in Tokyo the whole day is shorter than the API's 2 * MIN_SEGMENT_MS split guard, so no seed can pass.
  test.skip(
    Date.now() - at(today(), 0).getTime() < 2 * 60_000,
    'the Tokyo day is under two minutes old, so no current state is long enough to split',
  )
  // Arrange: 仕事 since midnight (the reload makes Home read the seeded day; the split must be at least two minutes in).
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  // replaceDay rewrites today only while it still holds the rows it names: the first-launch tap.
  const { rows: firstLaunch } = await api.switches.listByDay({ day: today() })
  await api.switches.replaceDay({
    day: today(),
    timeZone: 'Asia/Tokyo',
    expected: firstLaunch.map(({ id, activityId, startedAt }) => ({
      id,
      activityId,
      startedAt,
    })),
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(today(), 0) }],
  })
  await page.reload()
  await expect(page.getByText(/今日 0 回切替$/)).toBeVisible()
  await page.getByRole('link', { name: '訂正' }).click()
  await expect(
    page.getByRole('dialog', { name: '今日の記録を訂正' }),
  ).toBeVisible()

  // Act
  await page.getByRole('button', { name: /^仕事 0:00 – いま/ }).click()
  await page.getByRole('button', { name: '半分で分割' }).click()
  // Two 仕事 rows in the sheet (the unsplit row matched both halves' patterns); this also waits for the split to land.
  const dialog = page.getByRole('dialog', { name: '今日の記録を訂正' })
  const halves = dialog.getByRole('button', { name: /^仕事 / })
  await expect(halves.first()).toBeVisible()
  await expect(halves).toHaveCount(2)
  await page.getByRole('button', { name: '完了' }).click()

  // Assert: Home counts the new row as a switch straight away.
  await expect(page).toHaveURL('/')
  await expect(page.getByText(/今日 1 回切替$/)).toBeVisible()
})

test('a detox row lists as detox and comes back through undo', async ({
  page,
}) => {
  // Arrange: yesterday 仕事 9:00, detox 12:00, 娯楽 18:00
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: null, startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  await page.goto(`/correction?day=${yesterday}`)
  const detox = page.getByRole('button', { name: 'detox 12:00 – 18:00 6h 00m' })
  await expect(detox).toBeVisible()

  // Act: merge the detox span into 仕事, then undo
  await detox.click()
  await expect(page.getByRole('radio', { name: 'detox' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('button', { name: '前の記録に統合' }).click()
  await expect(
    page.getByRole('button', { name: '仕事 9:00 – 18:00 9h 00m' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert: 「元に戻す」 wrote the detox row back as a row with no activity
  await expect(detox).toBeVisible()
  await expect(
    page.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' }),
  ).toBeVisible()
})

test('the picker turns a segment into detox', async ({ page }) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
    ],
  })
  await page.goto(`/correction?day=${yesterday}`)
  await page.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' }).click()

  // Act
  await page.getByRole('radio', { name: 'detox' }).click()

  // Assert: the row is now detox and the picker shows it as the row's state
  await expect(
    page.getByRole('button', { name: 'detox 9:00 – 12:00 3h 00m' }),
  ).toBeVisible()
  await expect(page.getByRole('radio', { name: 'detox' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})

// `9月22日`, the form the carried-in panel writes a record's start date in.
const monthDay = (day: string) => {
  const [, month, date] = day.split('-').map(Number)
  return `${month}月${date}日`
}

// D−2 仕事 22:00 and D−1 食事 7:00: the D−1 sheet lists 仕事 0:00 – 7:00 as the record carried in from D−2 (9 h, under the
// 12 h idle threshold). Signs up (today's first-launch tap is 家事), seeds both days and opens D−1's sheet.
async function openCarriedInWork(page: Page) {
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const dayBefore = shift(today(), -2)
  const day = shift(today(), -1)
  await api.switches.replaceDay({
    day: dayBefore,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(dayBefore, 22) }],
  })
  await api.switches.replaceDay({
    day,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: idOf(list, '食事'), startedAt: at(day, 7) }],
  })
  await page.goto(`/correction?day=${day}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  const carriedIn = dialog.getByRole('button', {
    name: '仕事 0:00 – 7:00 7h 00m',
  })
  await expect(carriedIn).toBeVisible()
  return { api, list, dayBefore, day, dialog, carriedIn }
}

test('the carried-in record opens a panel that says where it started, and a pick changes the earlier day’s totals until undone', async ({
  page,
}) => {
  // Arrange
  const { api, list, dayBefore, dialog, carriedIn } =
    await openCarriedInWork(page)
  const work = idOf(list, '仕事')
  const sleep = idOf(list, '睡眠')

  // Act
  await carriedIn.click()
  await expect(
    dialog.getByText(`${monthDay(dayBefore)} 22:00 から続く記録です`),
  ).toBeVisible()
  await dialog.getByRole('radio', { name: '睡眠' }).click()

  // Assert: the whole record is 睡眠 now, so D−2's 22:00 – 24:00 moved from 仕事 to 睡眠.
  const slept = dialog.getByRole('button', { name: '睡眠 0:00 – 7:00 7h 00m' })
  await expect(slept).toBeVisible()
  const [afterPick] = (await api.stats.day({ day: dayBefore })).days
  expect([afterPick?.totals[work] ?? 0, afterPick?.totals[sleep]]).toEqual([
    0, 7_200_000,
  ])

  // Act: 元に戻す puts 仕事 back.
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert
  await expect(carriedIn).toBeVisible()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
  const [afterUndo] = (await api.stats.day({ day: dayBefore })).days
  expect([afterUndo?.totals[work], afterUndo?.totals[sleep] ?? 0]).toEqual([
    7_200_000, 0,
  ])
})

test('a pick on the carried-in record stays after the sheet closes', async ({
  page,
}) => {
  // Arrange
  const { api, list, dayBefore, dialog, carriedIn } =
    await openCarriedInWork(page)
  await carriedIn.click()
  await dialog.getByRole('radio', { name: '睡眠' }).click()
  await expect(
    dialog.getByRole('button', { name: '睡眠 0:00 – 7:00 7h 00m' }),
  ).toBeVisible()

  // Act
  await page.getByRole('button', { name: '完了' }).click()

  // Assert
  await expect(dialog).toHaveCount(0)
  const [stats] = (await api.stats.day({ day: dayBefore })).days
  expect(stats?.totals[idOf(list, '睡眠')]).toBe(7_200_000)
})

test('区切る時刻 opens at 3:15, cuts the carried-in record at 3:00 into a selected new row, and undo removes the cut', async ({
  page,
}) => {
  // Arrange
  const { dialog, carriedIn } = await openCarriedInWork(page)
  await carriedIn.click()
  const readout = dialog.getByRole('status', { name: '区切る時刻' })
  await expect(readout).toHaveText('3:15')

  // Act
  await dialog.getByRole('button', { name: '区切る時刻を15分早める' }).click()
  await expect(readout).toHaveText('3:00')
  await dialog.getByRole('button', { name: 'ここで分割' }).click()

  // Assert: the new row 3:00 – 7:00 is the selected, focused one, above the shortened carried-in record.
  const later = dialog.getByRole('button', { name: '仕事 3:00 – 7:00 4h 00m' })
  const earlier = dialog.getByRole('button', {
    name: '仕事 0:00 – 3:00 3h 00m',
  })
  await expect(later).toHaveAttribute('aria-expanded', 'true')
  await expect(later).toBeFocused()
  await expect(earlier).toHaveAttribute('aria-expanded', 'false')

  // Act
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert: one record again, selected, with nothing further to undo.
  await expect(carriedIn).toHaveAttribute('aria-expanded', 'true')
  await expect(later).toHaveCount(0)
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('after a cut, a pick changes only the later part of the record', async ({
  page,
}) => {
  // Arrange: the carried-in 仕事 cut at 3:15, where 区切る時刻 opens.
  const { dialog, carriedIn } = await openCarriedInWork(page)
  await carriedIn.click()
  await dialog.getByRole('button', { name: 'ここで分割' }).click()
  await expect(
    dialog.getByRole('button', { name: '仕事 3:15 – 7:00 3h 45m' }),
  ).toHaveAttribute('aria-expanded', 'true')

  // Act
  await dialog.getByRole('radio', { name: '睡眠' }).click()

  // Assert: the carried-in part keeps 仕事, so the earlier day is untouched.
  await expect(
    dialog.getByRole('button', { name: '睡眠 3:15 – 7:00 3h 45m' }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '仕事 0:00 – 3:15 3h 15m' }),
  ).toBeVisible()
})

test('a cut at 0:00 leaves the whole day to a new row, and undo selects the carried-in record again', async ({
  page,
}) => {
  // Arrange: from 3:15, three hours and a quarter back is 0:00, the earliest cut.
  const { dialog, carriedIn } = await openCarriedInWork(page)
  await carriedIn.click()
  const hourEarlier = dialog.getByRole('button', {
    name: '区切る時刻を1時間早める',
  })
  await hourEarlier.click()
  await hourEarlier.click()
  await hourEarlier.click()
  await dialog.getByRole('button', { name: '区切る時刻を15分早める' }).click()
  const readout = dialog.getByRole('status', { name: '区切る時刻' })
  await expect(readout).toHaveText('0:00')
  await expect(hourEarlier).toBeDisabled()

  // Act
  await dialog.getByRole('button', { name: 'ここで分割' }).click()

  // Assert: the carried-in record has nothing left in the day; 仕事 0:00 – 7:00 is now the day's own row, open with its panel.
  await expect(dialog.getByRole('button', { name: '半分で分割' })).toBeVisible()
  await expect(readout).toHaveCount(0)
  await expect(carriedIn).toHaveAttribute('aria-expanded', 'true')

  // Act
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert: the carried-in record is back, selected with its own panel, and 区切る時刻 opens at the middle again.
  await expect(readout).toHaveText('3:15')
  await expect(carriedIn).toHaveAttribute('aria-expanded', 'true')
  await expect(dialog.getByRole('button', { name: '半分で分割' })).toHaveCount(
    0,
  )
})

test('the carried-in panel warns before a pick away from an archived activity and says after it that undo is gone', async ({
  page,
}) => {
  // Arrange: 仕事 archived after the fixture was written (today's current state is 家事, so the archive is allowed).
  const { api, list, dialog, carriedIn } = await openCarriedInWork(page)
  await api.activities.archive({ id: idOf(list, '仕事') })
  await page.reload()
  await expect(carriedIn).toBeVisible()
  await carriedIn.click()
  await expect(
    dialog.getByText(
      'この記録の活動はアーカイブ済みです。別の活動に変えると元に戻せません',
    ),
  ).toBeVisible()

  // Act
  await dialog.getByRole('radio', { name: '睡眠' }).click()

  // Assert
  await expect(dialog.getByRole('alert')).toHaveText(
    '前の活動はアーカイブ済みのため、元に戻せません',
  )
  await expect(
    dialog.getByRole('button', { name: '睡眠 0:00 – 7:00 7h 00m' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('undoing a pick whose previous activity was archived meanwhile is refused with a notice', async ({
  page,
}) => {
  // Arrange: 睡眠 picked on the carried-in record, then 仕事 archived from another device.
  const { api, list, dialog, carriedIn } = await openCarriedInWork(page)
  await carriedIn.click()
  await dialog.getByRole('radio', { name: '睡眠' }).click()
  const slept = dialog.getByRole('button', { name: '睡眠 0:00 – 7:00 7h 00m' })
  await expect(slept).toBeVisible()
  await api.activities.archive({ id: idOf(list, '仕事') })

  // Act
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert
  await expect(dialog.getByRole('alert')).toHaveText(
    '前の活動はアーカイブ済みのため、元に戻せません',
  )
  await expect(slept).toBeVisible()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('undoing a pick never overwrites a change made on another device', async ({
  page,
}) => {
  // Arrange: 睡眠 picked on the carried-in record, then the same record changed to 娯楽 from another device.
  const { api, list, day, dialog, carriedIn } = await openCarriedInWork(page)
  await carriedIn.click()
  await dialog.getByRole('radio', { name: '睡眠' }).click()
  await expect(
    dialog.getByRole('button', { name: '睡眠 0:00 – 7:00 7h 00m' }),
  ).toBeVisible()
  const listed = await api.switches.listByDay({ day })
  if (!listed.carriedIn) throw new Error('no carried-in record')
  await api.switches.changeActivity({
    id: listed.carriedIn.id,
    activityId: idOf(list, '娯楽'),
  })

  // Act
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert: the undo is refused, the sheet shows 娯楽 and not 仕事, and 元に戻す is off.
  await expect(
    dialog.getByRole('button', { name: '娯楽 0:00 – 7:00 7h 00m' }),
  ).toBeVisible()
  await expect(carriedIn).toHaveCount(0)
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('a pick on a carried-in record changed elsewhere is refused instead of overwriting it', async ({
  page,
}) => {
  // Arrange: the sheet shows 仕事 while another device has already changed the record to 娯楽.
  const { api, list, day, dialog, carriedIn } = await openCarriedInWork(page)
  const listed = await api.switches.listByDay({ day })
  if (!listed.carriedIn) throw new Error('no carried-in record')
  await api.switches.changeActivity({
    id: listed.carriedIn.id,
    activityId: idOf(list, '娯楽'),
  })
  await carriedIn.click()

  // Act
  await dialog.getByRole('radio', { name: '睡眠' }).click()

  // Assert: the refused pick leaves 娯楽 in place and arms no undo.
  await expect(
    dialog.getByRole('button', { name: '娯楽 0:00 – 7:00 7h 00m' }),
  ).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^睡眠 / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('on a phone-width screen 区切る時刻 shares a line with its readout and the four steps share one row above a full-width ここで分割', async ({
  page,
}) => {
  // Arrange: a phone-width window, so the sheet fills the screen and the panel is 320 px wide.
  await page.setViewportSize({ width: 390, height: 844 })
  const { dialog, carriedIn } = await openCarriedInWork(page)

  // Act
  await carriedIn.click()
  const cut = dialog.getByRole('button', { name: 'ここで分割' })
  await expect(cut).toBeVisible()

  // Assert: four 74 px steps 8 px apart, then one 320 px button 8 px below; the label and the readout on one line.
  const [label, readout, first, second, third, fourth, cutBox] =
    await Promise.all([
      dialog.getByText('区切る時刻', { exact: true }).boundingBox(),
      dialog.getByRole('status', { name: '区切る時刻' }).boundingBox(),
      dialog
        .getByRole('button', { name: '区切る時刻を1時間早める' })
        .boundingBox(),
      dialog
        .getByRole('button', { name: '区切る時刻を15分早める' })
        .boundingBox(),
      dialog
        .getByRole('button', { name: '区切る時刻を15分遅らせる' })
        .boundingBox(),
      dialog
        .getByRole('button', { name: '区切る時刻を1時間遅らせる' })
        .boundingBox(),
      cut.boundingBox(),
    ])
  if (!label || !readout || !first || !second || !third || !fourth || !cutBox)
    throw new Error('a cut control has no box')
  expect(readout.y).toBeLessThan(label.y + label.height)
  expect(label.y).toBeLessThan(readout.y + readout.height)
  expect(readout.x + readout.width).toBe(first.x + 320)
  expect(first).toMatchObject({ width: 74, height: 44 })
  expect([second.x, third.x, fourth.x]).toEqual([
    first.x + 82,
    first.x + 164,
    first.x + 246,
  ])
  expect([second.y, third.y, fourth.y]).toEqual([first.y, first.y, first.y])
  expect(cutBox).toMatchObject({
    x: first.x,
    y: first.y + 52,
    width: 320,
    height: 44,
  })
})

test('the lines under ここで分割 follow the cut time and the day’s exclusion', async ({
  page,
}) => {
  // Arrange: D−3 仕事 20:00 runs until D−1 食事 0:00 (28 h, over the 12 h idle threshold), so D−2 has no row of its own.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const recordStart = shift(today(), -3)
  const day = shift(today(), -2)
  const recordEnd = shift(today(), -1)
  await api.switches.replaceDay({
    day: recordStart,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(recordStart, 20) }],
  })
  await api.switches.replaceDay({
    day: recordEnd,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: idOf(list, '食事'), startedAt: at(recordEnd, 0) }],
  })
  await page.goto(`/correction?day=${day}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  const carriedIn = dialog.getByRole('button', {
    name: '仕事 0:00 – 24:00 24h 00m',
  })
  const readout = dialog.getByRole('status', { name: '区切る時刻' })
  const idleNote = dialog.getByText(
    '区切ると、無操作扱い（12時間超）だった時間が集計に入ります',
  )
  const measuredNote = dialog.getByText(
    '区切ると、この日は計測できた日になります',
  )

  // Act
  await carriedIn.click()

  // Assert: 11:45 leaves 15h45 and 12h15, both still idle; the untapped day would become measured.
  await expect(readout).toHaveText('11:45')
  await expect(measuredNote).toBeVisible()
  await expect(idleNote).toHaveCount(0)

  // Act
  await dialog
    .getByRole('button', { name: '区切る時刻を1時間遅らせる' })
    .click()

  // Assert: 12:45 leaves 11h15 after the cut, which joins the totals.
  await expect(readout).toHaveText('12:45')
  await expect(idleNote).toBeVisible()

  // Act: the day is excluded by hand from another device.
  await api.excludedDays.exclude({ day })
  // The 計測 line also hides while the day's exclusion is loading, so wait for that answer before looking.
  const excludedAnswer = page.waitForResponse((response) =>
    response.url().includes('/api/rpc/excludedDays/list'),
  )
  await page.reload()
  expect((await excludedAnswer).ok()).toBe(true)
  await carriedIn.click()

  // Assert: a manual exclusion outranks a switch, so the 計測 line is gone.
  await expect(readout).toHaveText('11:45')
  await expect(measuredNote).toHaveCount(0)
})

test('a carried-in record with no quarter hour to cut at disables every step and ここで分割 and says why', async ({
  page,
}) => {
  // Arrange: 仕事 from 30 s before D−1's midnight until 食事 at 0:14.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const dayBefore = shift(today(), -2)
  const day = shift(today(), -1)
  await api.switches.replaceDay({
    day: dayBefore,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      {
        activityId: idOf(list, '仕事'),
        startedAt: new Date(`${dayBefore}T23:59:30+09:00`),
      },
    ],
  })
  await api.switches.replaceDay({
    day,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      {
        activityId: idOf(list, '食事'),
        startedAt: new Date(`${day}T00:14:00+09:00`),
      },
    ],
  })
  await page.goto(`/correction?day=${day}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })

  // Act
  await dialog.getByRole('button', { name: '仕事 0:00 – 0:14 14m' }).click()

  // Assert
  await expect(dialog.getByRole('status', { name: '区切る時刻' })).toHaveText(
    '—',
  )
  for (const name of [
    '区切る時刻を1時間早める',
    '区切る時刻を15分早める',
    '区切る時刻を15分遅らせる',
    '区切る時刻を1時間遅らせる',
    'ここで分割',
  ])
    await expect(dialog.getByRole('button', { name })).toBeDisabled()
  await expect(
    dialog.getByText('15分単位で区切れる時刻がありません'),
  ).toBeVisible()
})

// Yesterday 仕事 9:00, 休息 12:00, 娯楽 18:00 (today's first-launch tap closes 娯楽 at 24:00), for the status line's cases.
async function seedYesterday(page: Page) {
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(yesterday, 12) },
      { activityId: idOf(list, '娯楽'), startedAt: at(yesterday, 18) },
    ],
  })
  return { api, yesterday }
}

test('a refused edit says why under the rows until the next selection', async ({
  page,
}) => {
  // Arrange: the sheet lists 娯楽 at 18:00, then another device moves it to 17:45.
  const { api, yesterday } = await seedYesterday(page)
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  const staleRest = dialog.getByRole('button', {
    name: '休息 12:00 – 18:00 6h 00m',
  })
  await expect(staleRest).toBeVisible()
  const [, , leisure] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!leisure) throw new Error('no 娯楽 row')
  await api.switches.moveStart({ id: leisure.id, deltaMinutes: -15 })

  // Act: merge the stale 休息 into 仕事.
  await staleRest.click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()

  // Assert: the line names the refusal, and selecting another row clears it.
  await expect(dialog.getByRole('alert')).toHaveText(
    '別の端末で記録が変わったため、最新の状態を表示しました',
  )
  await dialog.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
})

test('undo after a merge restores the day the merge was pressed on, even when a refetch showed the merged day first', async ({
  page,
}) => {
  // Arrange: the merge's answer is held back after the API applied it, and the clock is controlled so the list goes stale.
  const { yesterday } = await seedYesterday(page)
  const applied = Promise.withResolvers<void>()
  const answer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/mergeIntoNext', async (route) => {
    const response = await route.fetch()
    applied.resolve()
    await answer.promise
    await route.fulfill({ response })
  })
  await page.clock.install()
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  const rest = dialog.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
  await rest.click()
  // Past the 30 s staleTime before the merge starts, so its deadline is not reached by the jump.
  await page.clock.fastForward('00:31')

  // Act: merge, let a focus refetch show the merged day while the answer is held, then release it and undo.
  await dialog.getByRole('button', { name: '次の記録に統合' }).click()
  await applied.promise
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(
    dialog.getByRole('button', { name: '娯楽 12:00 – 24:00 12h 00m' }),
  ).toBeVisible()
  answer.resolve()
  const undo = dialog.getByRole('button', { name: '元に戻す' })
  await expect(undo).toBeEnabled()
  await undo.click()

  // Assert: 休息 is back, which only a snapshot taken when the merge was pressed can do.
  await expect(rest).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '娯楽 18:00 – 24:00 6h 00m' }),
  ).toBeVisible()
})

test('an edit made offline says it waits for the connection, and lands once it is back', async ({
  page,
  context,
}) => {
  // Arrange
  const { yesterday } = await seedYesterday(page)
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()
  await context.setOffline(true)

  // Act
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()

  // Assert: the paused write explains the dim panel, then lands when the connection returns.
  await expect(
    dialog.getByText('オフラインです。接続が戻ると反映されます'),
  ).toBeVisible()
  await context.setOffline(false)
  await expect(
    dialog.getByRole('button', { name: '仕事 9:00 – 18:00 9h 00m' }),
  ).toBeVisible()
  await expect(
    dialog.getByText('オフラインです。接続が戻ると反映されます'),
  ).toHaveCount(0)
})

test('an edit whose answer never arrives gives up after 30 seconds, releases the panel and shows what landed', async ({
  page,
}) => {
  // Arrange: the API applies the merge, but its answer never reaches the app.
  const { yesterday } = await seedYesterday(page)
  await page.route('**/api/rpc/switches/mergeIntoNext', async (route) => {
    await route.fetch()
    await new Promise<never>(() => undefined)
  })
  await page.clock.install()
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()
  await dialog.getByRole('button', { name: '次の記録に統合' }).click()
  await expect(dialog.getByText('反映しています…')).toBeVisible()

  // Act
  await page.clock.fastForward('00:30')

  // Assert: the line says the list was read again, the merged day shows, and the panel answers again.
  await expect(dialog.getByRole('alert')).toHaveText(
    '応答がありませんでした。最新の状態を読み込み直しました',
  )
  const leisure = dialog.getByRole('button', {
    name: '娯楽 12:00 – 24:00 12h 00m',
  })
  await expect(leisure).toBeVisible()
  await leisure.click()
  await expect(
    dialog.getByRole('button', { name: '前の記録に統合' }),
  ).toBeEnabled()
})

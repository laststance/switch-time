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
// A History day's link, found by the name it reads out, which starts with the day as `formatDay` writes it (`9月24日（木）`).
const dayLink = (page: Page, day: string) => {
  const date = new Date(`${day}T00:00:00Z`)
  const weekday = '日月火水木金土'.charAt(date.getUTCDay())
  const name = `${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${weekday}）`
  return page.getByRole('link', { name: new RegExp(`^${name}`) })
}
const idOf = (list: { id: string; name: string }[], name: string) => {
  const activity = list.find((row) => row.name === name)
  if (!activity) throw new Error(`no activity named ${name}`)
  return activity.id
}
// An oRPC error answer as the API sends one, for a route that stands in for the API.
const rpcError = (code: string, status: number) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({
    json: { defined: false, code, status, message: code },
  }),
})

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

test('a detox row lists as detox, outlined solid in sub on its chip and the day bar, and comes back through undo', async ({
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
  // The row's chip is outlined solid in the `sub` tone of its time range, like every detox mark (dashed means no data).
  const chip = detox.locator('div').first()
  const sub = await detox
    .getByText('12:00 – 18:00')
    .evaluate((el) => getComputedStyle(el).color)
  await expect(chip).toHaveCSS('border-top-style', 'solid')
  await expect(chip).toHaveCSS('border-top-width', '1px')
  await expect(chip).toHaveCSS('border-top-color', sub)
  // The day bar's middle span (仕事, detox, 娯楽) is outlined the same way, as on Home's 24-h bar.
  const span = page.getByTestId('day-bar').locator('div').nth(1)
  await expect(span).toHaveCSS('border-top-style', 'solid')
  await expect(span).toHaveCSS('border-top-width', '1px')
  await expect(span).toHaveCSS('border-top-color', sub)

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

  // Assert: the undo is refused and says why, the sheet shows 娯楽 and not 仕事, and 元に戻す is off.
  await expect(
    dialog.getByRole('button', { name: '娯楽 0:00 – 7:00 7h 00m' }),
  ).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveText(
    'この記録が変わっていたため、最新の状態を表示しました',
  )
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
    '記録が変わっていたため、最新の状態を表示しました',
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

test('an edit whose answer never arrives gives up after 30 seconds, says it is reading the list again, then that it cannot tell whether the edit landed, and turns off the older undo', async ({
  page,
}) => {
  // Arrange: a split arms 元に戻す; then the API applies a merge, but its answer never reaches the app.
  const { yesterday } = await seedYesterday(page)
  await page.route('**/api/rpc/switches/mergeIntoNext', async (route) => {
    await route.fetch()
    await new Promise<never>(() => undefined)
  })
  await page.clock.install()
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' }).click()
  await dialog.getByRole('button', { name: '半分で分割' }).click()
  const undo = page.getByRole('button', { name: '元に戻す' })
  await expect(undo).toBeEnabled()
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()
  await dialog.getByRole('button', { name: '次の記録に統合' }).click()
  await expect(dialog.getByText('反映しています…')).toBeVisible()
  // The re-read after the timeout is held too, as a hung API would hold it.
  let releaseList = (): void => undefined
  const listHeld = new Promise<void>((resolve) => {
    releaseList = resolve
  })
  await page.route('**/api/rpc/switches/listByDay**', async (route) => {
    await listHeld
    await route.continue()
  })

  // Act
  await page.clock.fastForward('00:30')

  // Assert: at 30 s the quiet line says the list is being read again, and no alert claims anything before that read.
  await expect(dialog.getByRole('status')).toHaveText('一覧を読み直しています…')
  await expect(dialog.getByRole('alert')).toHaveCount(0)

  // Act: the re-read answers.
  releaseList()

  // Assert: the line says to check the list, the merged day shows, the panel answers again, and the split's undo stays off.
  await expect(dialog.getByRole('alert')).toHaveText(
    '反映されたか分かりませんでした。一覧で確かめてください',
  )
  const leisure = dialog.getByRole('button', {
    name: '娯楽 12:00 – 24:00 12h 00m',
  })
  await expect(leisure).toBeVisible()
  await leisure.click()
  await expect(
    dialog.getByRole('button', { name: '前の記録に統合' }),
  ).toBeEnabled()
  await expect(undo).toBeDisabled()
})

test('a write that lands at once says nothing, and one still in flight after 400 ms says it is landing', async ({
  page,
}) => {
  // Arrange: the clock is paused, and a merge's answer is held until released.
  const { yesterday } = await seedYesterday(page)
  let releaseMerge = (): void => undefined
  const mergeHeld = new Promise<void>((resolve) => {
    releaseMerge = resolve
  })
  await page.route('**/api/rpc/switches/mergeIntoPrevious', async (route) => {
    await mergeHeld
    await route.continue()
  })
  await page.clock.install()
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
  const writing = dialog.getByText('反映しています…')

  // Act: the merge is pressed; once the panel waits for it, 350 ms pass in all, short of the delay.
  const mergePrevious = dialog.getByRole('button', { name: '前の記録に統合' })
  await mergePrevious.click()
  await page.clock.runFor(100)
  await expect(mergePrevious).toBeDisabled()
  await page.clock.runFor(250)

  // Assert: no line yet.
  await expect(writing).toHaveCount(0)

  // Act: another 200 ms pass, past the delay even if its timer started late.
  await page.clock.runFor(200)

  // Assert: the line shows, and goes once the merge lands.
  await expect(writing).toBeVisible()
  releaseMerge()
  await page.clock.resume()
  await expect(
    dialog.getByRole('button', { name: '仕事 9:00 – 18:00 9h 00m' }),
  ).toBeVisible()
  await expect(writing).toHaveCount(0)
})

test('a refused undo says why under the rows and turns 元に戻す off', async ({
  page,
}) => {
  // Arrange: 休息 merged into 仕事 through the sheet, then another device splits 仕事 at 10:00.
  const { api, yesterday } = await seedYesterday(page)
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()
  await expect(
    dialog.getByRole('button', { name: '仕事 9:00 – 18:00 9h 00m' }),
  ).toBeVisible()
  const [work] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!work) throw new Error('no 仕事 row')
  await api.switches.splitAt({ id: work.id, at: at(yesterday, 10) })

  // Act
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert: the line names the refusal, the other device's row shows, and there is nothing left to undo.
  await expect(dialog.getByRole('alert')).toHaveText(
    '記録が変わっていたため、最新の状態を表示しました',
  )
  await expect(
    dialog.getByRole('button', { name: '仕事 10:00 – 18:00 8h 00m' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('a pick on a carried-in record changed on another device says that record changed', async ({
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

  // Assert
  await expect(dialog.getByRole('alert')).toHaveText(
    'この記録が変わっていたため、最新の状態を表示しました',
  )
  await expect(
    dialog.getByRole('button', { name: '娯楽 0:00 – 7:00 7h 00m' }),
  ).toBeVisible()
})

test('pressing the edit again on the refreshed list clears the refusal and lands', async ({
  page,
}) => {
  // Arrange: a merge of the stale 休息 is refused after another device moved 娯楽 to 17:45.
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
  await staleRest.click()
  const mergePrevious = dialog.getByRole('button', { name: '前の記録に統合' })
  await mergePrevious.click()
  await expect(dialog.getByRole('alert')).toHaveText(
    '記録が変わっていたため、最新の状態を表示しました',
  )
  await expect(
    dialog.getByRole('button', { name: '休息 12:00 – 17:45 5h 45m' }),
  ).toBeVisible()

  // Act: the row stays selected, so the same button is pressed again.
  await mergePrevious.click()

  // Assert: the refusal is gone and the merge landed on the day as it now reads.
  await expect(
    dialog.getByRole('button', { name: '仕事 9:00 – 17:45 8h 45m' }),
  ).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
})

test('an undo lost in transit says it cannot tell whether it landed, keeps 元に戻す for another try, and the retry clears the line', async ({
  page,
}) => {
  // Arrange: 休息 merged into 仕事 through the sheet, and the undo's request fails on the network once.
  const { yesterday } = await seedYesterday(page)
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  const rest = dialog.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
  await rest.click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()
  await expect(
    dialog.getByRole('button', { name: '仕事 9:00 – 18:00 9h 00m' }),
  ).toBeVisible()
  await page.route(
    '**/api/rpc/switches/replaceDay',
    async (route) => route.abort('internetdisconnected'),
    { times: 1 },
  )
  const undo = page.getByRole('button', { name: '元に戻す' })

  // Act
  await undo.click()

  // Assert: the line says to check the list (a lost answer may follow a landed write), and 元に戻す stays armed.
  await expect(dialog.getByRole('alert')).toHaveText(
    '反映されたか分かりませんでした。一覧で確かめてください',
  )
  await expect(undo).toBeEnabled()

  // Act: try again with the network back.
  await undo.click()

  // Assert: 休息 is back and the failure line is gone.
  await expect(rest).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(undo).toBeDisabled()
})

test('an edit answered with a server error after it landed says it cannot tell whether it landed, shows the rows it left and turns off the older undo', async ({
  page,
}) => {
  // Arrange: a split arms 元に戻す; then the API applies a merge, but the app gets a 500 in place of its answer.
  const { yesterday } = await seedYesterday(page)
  await page.route('**/api/rpc/switches/mergeIntoNext', async (route) => {
    await route.fetch()
    await route.fulfill(rpcError('INTERNAL_SERVER_ERROR', 500))
  })
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' }).click()
  await dialog.getByRole('button', { name: '半分で分割' }).click()
  const undo = page.getByRole('button', { name: '元に戻す' })
  await expect(undo).toBeEnabled()
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()

  // Act
  await dialog.getByRole('button', { name: '次の記録に統合' }).click()

  // Assert: the line says to check the list, the list shows the merge that landed, and the split's undo is off.
  await expect(dialog.getByRole('alert')).toHaveText(
    '反映されたか分かりませんでした。一覧で確かめてください',
  )
  await expect(
    dialog.getByRole('button', { name: '娯楽 12:00 – 24:00 12h 00m' }),
  ).toBeVisible()
  await expect(undo).toBeDisabled()
})

test('an edit the API gave up on before writing says it was not saved and keeps the older undo', async ({
  page,
}) => {
  // Arrange: a split arms 元に戻す; then a merge is answered with the API's own TIMEOUT, which it sends as a 500.
  const { yesterday } = await seedYesterday(page)
  await page.route('**/api/rpc/switches/mergeIntoNext', async (route) =>
    route.fulfill(rpcError('TIMEOUT', 500)),
  )
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' }).click()
  await dialog.getByRole('button', { name: '半分で分割' }).click()
  const undo = page.getByRole('button', { name: '元に戻す' })
  await expect(undo).toBeEnabled()
  const rest = dialog.getByRole('button', {
    name: '休息 12:00 – 18:00 6h 00m',
  })
  await rest.click()

  // Act
  await dialog.getByRole('button', { name: '次の記録に統合' }).click()

  // Assert: the retry line, the day as it was, and the split still undoable.
  await expect(dialog.getByRole('alert')).toHaveText(
    '保存できませんでした。もう一度お試しください',
  )
  await expect(rest).toBeVisible()
  await expect(undo).toBeEnabled()
})

test('after an edit that may have landed, a list that cannot be read again says the rows may be old, until a later read lands', async ({
  page,
}) => {
  // Arrange: the merge's answer is lost after it landed, and every read of the list after that fails, its retry included.
  const { yesterday } = await seedYesterday(page)
  let listFails = false
  await page.route('**/api/rpc/switches/mergeIntoNext', async (route) => {
    await route.fetch()
    listFails = true
    await route.abort('internetdisconnected')
  })
  await page.route('**/api/rpc/switches/listByDay**', async (route) =>
    listFails
      ? route.fulfill(rpcError('INTERNAL_SERVER_ERROR', 500))
      : route.continue(),
  )
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()

  // Act
  await dialog.getByRole('button', { name: '次の記録に統合' }).click()

  // Assert: the line says the rows may be old, over the rows from before the merge.
  await expect(dialog.getByRole('alert')).toHaveText(
    '一覧を読み直せませんでした。表示が古いかもしれません',
  )
  await expect(
    dialog.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' }),
  ).toBeVisible()

  // Act: the list answers again, and the tab comes back into view, which reads it.
  listFails = false
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))

  // Assert: the merge that landed shows, and the line goes back to saying the edit's own failure.
  await expect(
    dialog.getByRole('button', { name: '娯楽 12:00 – 24:00 12h 00m' }),
  ).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveText(
    '反映されたか分かりませんでした。一覧で確かめてください',
  )
})

test('an edit that may have landed while the connection went down says it is reading the list again until the connection is back', async ({
  page,
  context,
}) => {
  // Arrange: the API applies the merge, then the connection drops before its answer arrives.
  const { yesterday } = await seedYesterday(page)
  await page.route('**/api/rpc/switches/mergeIntoNext', async (route) => {
    await route.fetch()
    await context.setOffline(true)
    await route.abort('internetdisconnected')
  })
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()

  // Act
  await dialog.getByRole('button', { name: '次の記録に統合' }).click()

  // Assert: the quiet line waits for the read, with no alert while the read cannot run.
  await expect(dialog.getByRole('status')).toHaveText('一覧を読み直しています…')
  await expect(dialog.getByRole('alert')).toHaveCount(0)

  // Act
  await context.setOffline(false)

  // Assert: the read lands, so the merge shows and the line says to check it.
  await expect(
    dialog.getByRole('button', { name: '娯楽 12:00 – 24:00 12h 00m' }),
  ).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveText(
    '反映されたか分かりませんでした。一覧で確かめてください',
  )
})

test('an edit refused as signed out keeps asking to sign in again while the list cannot be read either', async ({
  page,
}) => {
  // Arrange: the merge and every read of the list after it answer UNAUTHORIZED; the session read still answers.
  const { yesterday } = await seedYesterday(page)
  let signedOut = false
  await page.route('**/api/rpc/switches/mergeIntoPrevious', async (route) => {
    signedOut = true
    await route.fulfill(rpcError('UNAUTHORIZED', 401))
  })
  const listRefused = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/listByDay**', async (route) => {
    if (!signedOut) return route.continue()
    await route.fulfill(rpcError('UNAUTHORIZED', 401))
    listRefused.resolve()
  })
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()

  // Act
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()
  await listRefused.promise
  // Nothing on screen marks the refused read landing in the query cache, so give it time to (a 401 is not retried).
  await page.waitForTimeout(500)

  // Assert: the sign-in line stays, rather than turning into the unread-list line.
  await expect(dialog.getByRole('alert')).toHaveText(
    'サインインが切れました。サインインし直してください',
  )
})

test('an edit refused as signed out takes the user to sign-in once the session reads empty, with the way back to the sheet', async ({
  page,
}) => {
  // Arrange: the merge answers UNAUTHORIZED, and from then on the session read answers that nobody is signed in.
  const { yesterday } = await seedYesterday(page)
  let signedOut = false
  await page.route('**/api/rpc/switches/mergeIntoPrevious', async (route) => {
    signedOut = true
    await route.fulfill(rpcError('UNAUTHORIZED', 401))
  })
  await page.route('**/api/auth/get-session**', async (route) =>
    signedOut
      ? route.fulfill({ contentType: 'application/json', body: 'null' })
      : route.continue(),
  )
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()

  // Act
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()

  // Assert: the sign-in screen, with `next` naming this day's sheet.
  await expect(page).toHaveURL(/\/sign-in\?next=/)
  expect(new URL(page.url()).searchParams.get('next')).toBe(
    `/correction?day=${yesterday}`,
  )
})

test('a refusal on today’s sheet is gone when the sheet opens again after a tap on ホーム changed the day', async ({
  page,
}) => {
  test.skip(
    Date.now() - at(today(), 0).getTime() < 16 * 60_000,
    'the Tokyo day is under 16 minutes old, so 家事 cannot start 15 minutes earlier',
  )
  // Arrange: today's 家事 is moved 15 minutes earlier elsewhere, so the sheet's own move is refused; then the sheet closes.
  await signUp(page)
  const api = await apiAs(page)
  await page.goto('/correction')
  const dialog = page.getByRole('dialog', { name: '今日の記録を訂正' })
  const chores = dialog.getByRole('button', { name: /^家事 / })
  await expect(chores).toBeVisible()
  const [tapped] = (await api.switches.listByDay({ day: today() })).rows
  if (!tapped) throw new Error('no 家事 row')
  await api.switches.moveStart({ id: tapped.id, deltaMinutes: -15 })
  await chores.click()
  await dialog.getByRole('button', { name: '15分早める' }).click()
  await expect(dialog.getByRole('alert')).toHaveText(
    '記録が変わっていたため、最新の状態を表示しました',
  )
  await page.getByRole('button', { name: '完了' }).click()

  // Act: a tap on ホーム starts 休息, then today's sheet opens again.
  const tapLanded = page.waitForResponse((response) =>
    response.url().includes('/api/rpc/switches/switchTo'),
  )
  await page.getByRole('button', { name: '休息' }).click()
  expect((await tapLanded).ok()).toBe(true)
  await page.getByRole('link', { name: '訂正' }).click()

  // Assert: the sheet lists the tap, and the refusal about the day before it is gone.
  await expect(dialog.getByRole('button', { name: /^休息 / })).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
})

test('元に戻す stays off once ホーム read the day changed elsewhere, even after that change was put back', async ({
  page,
}) => {
  test.skip(
    Date.now() - at(today(), 0).getTime() < 10 * 60_000,
    'the Tokyo day is under 10 minutes old, too short for 休息 at 0:08',
  )
  // Arrange: today 仕事 from 0:00 and 休息 from 0:08; 休息 is merged into 仕事 in the sheet, which arms 元に戻す; the sheet closes.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const { rows: firstLaunch } = await api.switches.listByDay({ day: today() })
  await api.switches.replaceDay({
    day: today(),
    timeZone: 'Asia/Tokyo',
    expected: firstLaunch.map(({ id, activityId, startedAt }) => ({
      id,
      activityId,
      startedAt,
    })),
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(today(), 0) },
      {
        activityId: idOf(list, '休息'),
        startedAt: new Date(at(today(), 0).getTime() + 8 * 60_000),
      },
    ],
  })
  await page.clock.install()
  await page.goto('/correction')
  const dialog = page.getByRole('dialog', { name: '今日の記録を訂正' })
  await dialog.getByRole('button', { name: /^休息 0:08 – / }).click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()
  const undo = page.getByRole('button', { name: '元に戻す' })
  await expect(undo).toBeEnabled()
  await page.getByRole('button', { name: '完了' }).click()
  const [work] = (await api.switches.listByDay({ day: today() })).rows
  if (!work) throw new Error('no 仕事 row')

  // Act: another device changes 仕事 to 娯楽, ホーム reads today once it is stale, then that device puts 仕事 back.
  await api.switches.changeActivity({
    id: work.id,
    activityId: idOf(list, '娯楽'),
  })
  await page.clock.fastForward('00:31')
  const homeRead = page.waitForResponse((response) =>
    response.url().includes('/api/rpc/switches/listByDay'),
  )
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await homeRead
  await expect(page.getByRole('button', { name: '娯楽' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await api.switches.changeActivity({
    id: work.id,
    activityId: idOf(list, '仕事'),
  })
  await page.clock.fastForward('00:31')
  await page.getByRole('link', { name: '訂正' }).click()

  // Assert: the sheet lists 仕事 again, as the merge left it, yet offers no undo over a day that changed in between.
  await expect(
    dialog.getByRole('button', { name: /^仕事 0:00 – / }),
  ).toBeVisible()
  await expect(undo).toBeDisabled()
})

test('the sheet keeps an empty polite region that takes no room while nothing is said', async ({
  page,
}) => {
  // Arrange
  const { yesterday } = await seedYesterday(page)

  // Act
  await page.goto(`/correction?day=${yesterday}`)

  // Assert: one polite region, empty and out of the column's flow, ready for the first quiet line.
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await expect(
    dialog.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' }),
  ).toBeVisible()
  const polite = dialog.getByRole('status')
  await expect(polite).toHaveCount(1)
  await expect(polite).toHaveText('')
  await expect(polite).toHaveCSS('position', 'absolute')
  expect((await polite.boundingBox())?.height).toBeLessThanOrEqual(1)
})

test('a merge that lands after its sheet closed can still be undone from that day’s sheet', async ({
  page,
}) => {
  // Arrange: the API applies a merge of 休息 into 仕事, but its answer is held back until the sheet has closed.
  const { yesterday } = await seedYesterday(page)
  const answer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/mergeIntoPrevious', async (route) => {
    const response = await route.fetch()
    await answer.promise
    await route.fulfill({ response })
  })
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  const rest = dialog.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
  await rest.click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()

  // Act: close the sheet, let the answer land, then open the same day again from History and undo.
  await page.getByRole('button', { name: '完了' }).click()
  answer.resolve()
  await page.getByRole('tab', { name: '記録' }).click()
  await dayLink(page, yesterday).click()
  const undo = page.getByRole('button', { name: '元に戻す' })
  await expect(undo).toBeEnabled()
  await undo.click()

  // Assert: 休息 is back with its old span.
  await expect(rest).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' }),
  ).toBeVisible()
  await expect(undo).toBeDisabled()
})

test('a settings change made while a day’s sheet is closed keeps that day’s 元に戻す', async ({
  page,
}) => {
  // Arrange: a merge of 休息 into 仕事 lands after its sheet closed, so the day's cached list still predates it.
  const { yesterday } = await seedYesterday(page)
  const answer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/mergeIntoPrevious', async (route) => {
    const response = await route.fetch()
    await answer.promise
    await route.fulfill({ response })
  })
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  const rest = dialog.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
  await rest.click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()
  await page.getByRole('button', { name: '完了' }).click()
  const landed = page.waitForResponse('**/api/rpc/switches/mergeIntoPrevious')
  answer.resolve()
  await landed

  // Act: change the appearance in 設定 and wait for the server to store it and for the write to settle (its re-read of the
  // settings is the last step before it does), then open the day again from History.
  await page.getByRole('tab', { name: '設定' }).click()
  const settled = page.waitForResponse('**/api/rpc/settings/get')
  await page.getByRole('button', { name: '暗' }).click()
  const api = await apiAs(page)
  await expect.poll(async () => (await api.settings.get()).theme).toBe('dark')
  await settled
  await page.getByRole('tab', { name: '記録' }).click()
  await dayLink(page, yesterday).click()

  // Assert: the merge can still be undone.
  const undo = page.getByRole('button', { name: '元に戻す' })
  await expect(undo).toBeEnabled()
  await undo.click()
  await expect(rest).toBeVisible()
})

test('元に戻す stays off once the merge’s own re-read saw another device’s change, even after that change was put back', async ({
  page,
}) => {
  // Arrange: the API applies a merge of 休息 into 仕事 and holds its answer, while another device changes 仕事 to 休息.
  const { api, yesterday } = await seedYesterday(page)
  const list = await api.activities.list()
  const merged = Promise.withResolvers<void>()
  const answer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/mergeIntoPrevious', async (route) => {
    const response = await route.fetch()
    merged.resolve()
    await answer.promise
    await route.fulfill({ response })
  })
  await page.clock.install()
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()
  await merged.promise
  const work = (await api.switches.listByDay({ day: yesterday })).rows.find(
    ({ activityId }) => activityId === idOf(list, '仕事'),
  )
  if (!work) throw new Error('no 仕事 row')
  await api.switches.changeActivity({
    id: work.id,
    activityId: idOf(list, '休息'),
  })

  // Act: the answer lands and the merge reads the day again, then that device puts 仕事 back and the sheet reads it once stale.
  answer.resolve()
  await expect(
    dialog.getByRole('button', { name: '休息 9:00 – 18:00 9h 00m' }),
  ).toBeVisible()
  await api.switches.changeActivity({
    id: work.id,
    activityId: idOf(list, '仕事'),
  })
  await page.clock.fastForward('00:31')
  const reread = page.waitForResponse((response) =>
    response.url().includes('/api/rpc/switches/listByDay'),
  )
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await reread

  // Assert: the sheet lists 仕事 as the merge left it, yet offers no undo over a day that changed in between.
  await expect(
    dialog.getByRole('button', { name: '仕事 9:00 – 18:00 9h 00m' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('an undo that lands after its sheet closed leaves nothing to undo when that day is reopened', async ({
  page,
}) => {
  // Arrange: 休息 merged into 仕事, then 元に戻す pressed with the replaceDay answer held back until the sheet has closed.
  const { yesterday } = await seedYesterday(page)
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  const rest = dialog.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
  await rest.click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()
  const undo = page.getByRole('button', { name: '元に戻す' })
  await expect(undo).toBeEnabled()
  const answer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/replaceDay', async (route) => {
    const response = await route.fetch()
    await answer.promise
    await route.fulfill({ response })
  })
  await undo.click()

  // Act: close the sheet, let the undo's answer land, then open the same day again from History.
  await page.getByRole('button', { name: '完了' }).click()
  answer.resolve()
  await page.getByRole('tab', { name: '記録' }).click()
  await dayLink(page, yesterday).click()

  // Assert: 休息 is back and 元に戻す is off, so the applied undo cannot be pressed again.
  await expect(rest).toBeVisible()
  await expect(undo).toBeDisabled()
})

test('a merge that lands after sign-out leaves no 元に戻す for the next account', async ({
  page,
}) => {
  // Arrange: account A's merge is applied, its answer held back while A closes the sheet and signs out.
  const { yesterday } = await seedYesterday(page)
  const answer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/mergeIntoPrevious', async (route) => {
    const response = await route.fetch()
    await answer.promise
    await route.fulfill({ response })
  })
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()
  await page.getByRole('button', { name: '完了' }).click()
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('button', { name: 'サインアウト' }).click()
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeVisible()

  // Act: A's answer lands; B signs up in the same page (no reload, so the store survives) and opens the same date.
  const delivered = page.waitForResponse(
    '**/api/rpc/switches/mergeIntoPrevious',
  )
  answer.resolve()
  await delivered
  await page.getByRole('link', { name: '新規登録はこちら' }).click()
  // The sign-in screen stays mounted under sign-up, so its fields are skipped by visibility.
  await page.getByLabel('名前').fill('E2E B')
  await page
    .getByLabel('メールアドレス')
    .filter({ visible: true })
    .fill(`e2e-b-${Date.now()}@example.com`)
  await page
    .getByLabel('パスワード')
    .filter({ visible: true })
    .fill('correct-horse-battery')
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await page.getByRole('button', { name: '家事' }).click()
  await expect(
    page.getByRole('heading', { name: 'いま', exact: true }),
  ).toBeVisible()
  const api = await apiAs(page)
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: idOf(list, '食事'), startedAt: at(yesterday, 9) }],
  })
  await page.getByRole('tab', { name: '記録' }).click()
  await dayLink(page, yesterday).click()

  // Assert: B's sheet for that date lists B's row and offers nothing to undo.
  await expect(
    dialog.getByRole('button', { name: '食事 9:00 – 24:00 15h 00m' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('signing in as someone else in another tab leaves no 元に戻す from the previous account', async ({
  page,
  context,
}) => {
  // Arrange: account A merges 休息 into 仕事 on yesterday's sheet, so that day holds an armed 元に戻す, and closes the sheet.
  const { yesterday } = await seedYesterday(page)
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeEnabled()
  await page.getByRole('button', { name: '完了' }).click()

  // Act: a second tab signs A out and signs up as B, who records 食事 on the same date; the first tab follows the session.
  const other = await context.newPage()
  await other.goto('/')
  await other.getByRole('tab', { name: '設定' }).click()
  await other.getByRole('button', { name: 'サインアウト' }).click()
  await expect(other.getByRole('button', { name: 'サインイン' })).toBeVisible()
  await signUp(other)
  const api = await apiAs(other)
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: idOf(list, '食事'), startedAt: at(yesterday, 9) }],
  })
  // Coming back to the first tab refetches its session (a sign-up does not broadcast to other tabs, a sign-out does).
  await page.bringToFront()
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  )
  await expect(
    page.getByRole('heading', { name: 'いま', exact: true }),
  ).toBeVisible()
  await page.getByRole('tab', { name: '記録' }).click()
  await dayLink(page, yesterday).click()

  // Assert: the first tab's sheet for that date lists B's row, not A's cached ones, and offers nothing to undo.
  await expect(
    dialog.getByRole('button', { name: '食事 9:00 – 24:00 15h 00m' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('a double tap on 半分で分割 splits once, says why the second was refused, and keeps saying it after the first lands', async ({
  page,
}) => {
  // Arrange
  const { yesterday } = await seedYesterday(page)
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  const rest = dialog.getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
  await rest.click()

  // Act: two presses in one task, before any render can dim the button.
  await dialog
    .getByRole('button', { name: '半分で分割' })
    .evaluate((button: HTMLElement) => {
      button.click()
      button.click()
    })

  // Assert: one split landed and armed 元に戻す, its later half is selected, and the second press's refusal stays.
  const laterHalf = dialog.getByRole('button', {
    name: '休息 15:00 – 18:00 3h 00m',
  })
  await expect(laterHalf).toHaveAttribute('aria-expanded', 'true')
  const undo = page.getByRole('button', { name: '元に戻す' })
  await expect(undo).toBeEnabled()
  await expect(dialog.getByRole('alert')).toHaveText(
    '記録が変わっていたため、最新の状態を表示しました',
  )

  // Act
  await undo.click()

  // Assert: the day before the split is back, with the halved row selected again.
  await expect(rest).toHaveAttribute('aria-expanded', 'true')
  await expect(laterHalf).toHaveCount(0)
})

test('半分で分割 selects the later half, so the next pick changes only that half', async ({
  page,
}) => {
  // Arrange
  const { yesterday } = await seedYesterday(page)
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' }).click()

  // Act
  await dialog.getByRole('button', { name: '半分で分割' }).click()
  const laterHalf = dialog.getByRole('button', {
    name: '仕事 10:30 – 12:00 1h 30m',
  })
  await expect(laterHalf).toHaveAttribute('aria-expanded', 'true')
  await expect(laterHalf).toBeFocused()
  await dialog.getByRole('radio', { name: '睡眠' }).click()

  // Assert
  await expect(
    dialog.getByRole('button', { name: '睡眠 10:30 – 12:00 1h 30m' }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '仕事 9:00 – 10:30 1h 30m' }),
  ).toBeVisible()
})

test('undoing 半分で分割 joins the halves and selects the joined row again', async ({
  page,
}) => {
  // Arrange
  const { yesterday } = await seedYesterday(page)
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  const work = dialog.getByRole('button', { name: '仕事 9:00 – 12:00 3h 00m' })
  await work.click()
  await dialog.getByRole('button', { name: '半分で分割' }).click()
  const laterHalf = dialog.getByRole('button', {
    name: '仕事 10:30 – 12:00 1h 30m',
  })
  await expect(laterHalf).toHaveAttribute('aria-expanded', 'true')

  // Act
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert
  await expect(work).toHaveAttribute('aria-expanded', 'true')
  await expect(laterHalf).toHaveCount(0)
})

test('a refusal shows at once even when the connection drops before the list is read again', async ({
  page,
  context,
}) => {
  // Arrange: the sheet lists 娯楽 at 18:00 and another device moves it to 17:45. The connection drops during the list's
  // re-read after the refusal, so its retry waits for the network (one already offline when it starts would not wait).
  const { api, yesterday } = await seedYesterday(page)
  let refused = false
  await page.route('**/api/rpc/switches/mergeIntoPrevious', async (route) => {
    refused = true
    await route.continue()
  })
  await page.route('**/api/rpc/switches/listByDay**', async (route) => {
    if (!refused) return route.continue()
    await context.setOffline(true)
    return route.abort('internetdisconnected')
  })
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  const staleRest = dialog.getByRole('button', {
    name: '休息 12:00 – 18:00 6h 00m',
  })
  await expect(staleRest).toBeVisible()
  const [, , leisure] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!leisure) throw new Error('no 娯楽 row')
  await api.switches.moveStart({ id: leisure.id, deltaMinutes: -15 })

  // Act
  await staleRest.click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()

  // Assert: the line names the refusal rather than waiting for the connection.
  await expect(dialog.getByRole('alert')).toHaveText(
    '記録が変わっていたため、最新の状態を表示しました',
  )
  await expect(
    dialog
      .getByRole('status')
      .filter({ hasText: 'オフラインです。接続が戻ると反映されます' }),
  ).toHaveCount(0)
})

test('a refusal on today’s sheet does not follow the sheet into the next day at midnight', async ({
  page,
}) => {
  // Arrange: today's sheet lists 家事 where signing up tapped it, then another device moves it 15 minutes earlier.
  await signUp(page)
  const api = await apiAs(page)
  await page.clock.install()
  await page.goto('/correction')
  const dialog = page.getByRole('dialog', { name: '今日の記録を訂正' })
  const chores = dialog.getByRole('button', { name: /^家事 / })
  await expect(chores).toBeVisible()
  const [tapped] = (await api.switches.listByDay({ day: today() })).rows
  if (!tapped) throw new Error('no 家事 row')
  await api.switches.moveStart({ id: tapped.id, deltaMinutes: -15 })
  await chores.click()
  await dialog.getByRole('button', { name: '15分早める' }).click()
  await expect(dialog.getByRole('alert')).toHaveText(
    '記録が変わっていたため、最新の状態を表示しました',
  )

  // Act: the clock passes midnight, so the sheet follows the new day.
  const midnight = new Date(`${shift(today(), 1)}T00:00:30+09:00`)
  await page.clock.fastForward(midnight.getTime() - Date.now())

  // Assert
  await expect(
    page.getByRole('dialog', { name: '今日の記録を訂正' }),
  ).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
})

test('an undo refused because it would make an archived activity the current state says so in one line and turns 元に戻す off', async ({
  page,
}) => {
  // Arrange: today 仕事 from 0:00, then 家事 (the first-launch tap) running; 家事 is merged into 仕事, then archived elsewhere.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const day = today()
  const listed = await api.switches.listByDay({ day })
  const [tapped] = listed.rows
  if (!tapped) throw new Error('no 家事 row')
  await api.switches.replaceDay({
    day,
    timeZone: 'Asia/Tokyo',
    expected: listed.rows.map(({ id, activityId, startedAt }) => ({
      id,
      activityId,
      startedAt,
    })),
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(day, 0) },
      { activityId: tapped.activityId, startedAt: tapped.startedAt },
    ],
  })
  await page.goto('/correction')
  const dialog = page.getByRole('dialog', { name: '今日の記録を訂正' })
  await dialog.getByRole('button', { name: /^家事 / }).click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()
  await expect(dialog.getByRole('button', { name: /^家事 / })).toHaveCount(0)
  await api.activities.archive({ id: idOf(list, '家事') })

  // Act
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Assert: one alert, the line rather than a row notice, and nothing left to undo.
  await expect(dialog.getByRole('alert')).toHaveCount(1)
  await expect(dialog.getByRole('alert')).toHaveText(
    'アーカイブ済みの活動になるため、変更できません',
  )
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

// Today 仕事 from 0:00, in place of the first-launch tap, then today's sheet opened from Home. Splitting or tapping the running
// record needs it at least two minutes old, so the tests that use this skip the first two minutes of the Tokyo day.
async function openTodayWorkSinceMidnight(page: Page) {
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
  return { api, list }
}

test('元に戻す turns off once a tap on ホーム changed the day after the edit', async ({
  page,
}) => {
  test.skip(
    Date.now() - at(today(), 0).getTime() < 2 * 60_000,
    'the Tokyo day is under two minutes old, so the running record is too short to change',
  )
  // Arrange: today's 仕事 picked as 睡眠 in the sheet, which arms 元に戻す; then the sheet closes.
  await openTodayWorkSinceMidnight(page)
  await page.goto('/correction')
  const dialog = page.getByRole('dialog', { name: '今日の記録を訂正' })
  await dialog.getByRole('button', { name: /^仕事 0:00 – / }).click()
  await dialog.getByRole('radio', { name: '睡眠' }).click()
  await expect(
    dialog.getByRole('button', { name: /^睡眠 0:00 – / }),
  ).toBeVisible()
  const undo = page.getByRole('button', { name: '元に戻す' })
  await expect(undo).toBeEnabled()
  await page.getByRole('button', { name: '完了' }).click()

  // Act: a tap on ホーム starts 休息, then today's sheet opens again.
  await page.getByRole('button', { name: '休息' }).click()
  await expect(page.getByText(/今日 1 回切替$/)).toBeVisible()
  await page.getByRole('link', { name: '訂正' }).click()

  // Assert: the sheet lists the tap, and offers no undo that could only be refused as another device's change.
  await expect(dialog.getByRole('button', { name: /^休息 / })).toBeVisible()
  await expect(undo).toBeDisabled()
})

test('an edit refused after its sheet closed says why when that day’s sheet opens again', async ({
  page,
}) => {
  // Arrange: 休息 merged into 仕事, the request held back while the sheet closes and another device moves 娯楽 to 17:45.
  const { api, yesterday } = await seedYesterday(page)
  const sent = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/mergeIntoPrevious', async (route) => {
    await sent.promise
    await route.continue()
  })
  await page.goto(`/correction?day=${yesterday}`)
  const dialog = page.getByRole('dialog', { name: /の記録を訂正$/ })
  await dialog
    .getByRole('button', { name: '休息 12:00 – 18:00 6h 00m' })
    .click()
  await dialog.getByRole('button', { name: '前の記録に統合' }).click()
  await page.getByRole('button', { name: '完了' }).click()
  const [, , leisure] = (await api.switches.listByDay({ day: yesterday })).rows
  if (!leisure) throw new Error('no 娯楽 row')
  await api.switches.moveStart({ id: leisure.id, deltaMinutes: -15 })

  // Act: the merge reaches the API, which refuses it, then the same day opens again from History.
  sent.resolve()
  await page.getByRole('tab', { name: '記録' }).click()
  await dayLink(page, yesterday).click()

  // Assert: the line says the merge did not happen, over the rows another device left.
  await expect(dialog.getByRole('alert')).toHaveText(
    '記録が変わっていたため、最新の状態を表示しました',
  )
  await expect(
    dialog.getByRole('button', { name: '休息 12:00 – 17:45 5h 45m' }),
  ).toBeVisible()
})

test('an undo refused as archived after its sheet closed shows the notice on the record when that day’s sheet opens again', async ({
  page,
}) => {
  // Arrange: 睡眠 picked on the carried-in record, 仕事 archived from another device, then 元に戻す pressed with its answer
  // held back until the sheet has closed.
  const { api, list, day, dialog, carriedIn } = await openCarriedInWork(page)
  await carriedIn.click()
  await dialog.getByRole('radio', { name: '睡眠' }).click()
  const slept = dialog.getByRole('button', { name: '睡眠 0:00 – 7:00 7h 00m' })
  await expect(slept).toBeVisible()
  await api.activities.archive({ id: idOf(list, '仕事') })
  const answer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/changeActivity', async (route) => {
    const response = await route.fetch()
    await answer.promise
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: '元に戻す' }).click()

  // Act: close the sheet, let the refusal land, then open the same day again from History.
  await page.getByRole('button', { name: '完了' }).click()
  answer.resolve()
  await page.getByRole('tab', { name: '記録' }).click()
  await dayLink(page, day).click()

  // Assert: the record's panel is open on the notice, and 元に戻す is off.
  await expect(slept).toHaveAttribute('aria-expanded', 'true')
  await expect(dialog.getByRole('alert')).toHaveText(
    '前の活動はアーカイブ済みのため、元に戻せません',
  )
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

test('a pick on the record a kept notice opened keeps its panel open while the pick is written', async ({
  page,
}) => {
  // Arrange: the archived notice from an undo refused after its sheet closed opens the record when that day's sheet opens again.
  const { api, list, day, dialog, carriedIn } = await openCarriedInWork(page)
  await carriedIn.click()
  await dialog.getByRole('radio', { name: '睡眠' }).click()
  const slept = dialog.getByRole('button', { name: '睡眠 0:00 – 7:00 7h 00m' })
  await expect(slept).toBeVisible()
  await api.activities.archive({ id: idOf(list, '仕事') })
  const answer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/changeActivity', async (route) => {
    const response = await route.fetch()
    await answer.promise
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: '元に戻す' }).click()
  await page.getByRole('button', { name: '完了' }).click()
  answer.resolve()
  await page.getByRole('tab', { name: '記録' }).click()
  await dayLink(page, day).click()
  await expect(slept).toHaveAttribute('aria-expanded', 'true')
  await page.unroute('**/api/rpc/switches/changeActivity')

  // Act: 休息 picked on the record the notice opened.
  await dialog.getByRole('radio', { name: '休息' }).click()

  // Assert: the record's panel stays open on the pick, and the notice is gone.
  const rested = dialog.getByRole('button', { name: '休息 0:00 – 7:00 7h 00m' })
  await expect(rested).toHaveAttribute('aria-expanded', 'true')
  await expect(dialog.getByRole('alert')).toBeHidden()
})

test('an archived notice that lands while another row is selected shows once its record is tapped', async ({
  page,
}) => {
  // Arrange: 睡眠 picked on the carried-in record, 仕事 archived from another device, 元に戻す pressed with its answer held,
  // and the sheet closed and opened again from History before the answer lands.
  const { api, list, day, dialog, carriedIn } = await openCarriedInWork(page)
  await carriedIn.click()
  await dialog.getByRole('radio', { name: '睡眠' }).click()
  const slept = dialog.getByRole('button', { name: '睡眠 0:00 – 7:00 7h 00m' })
  await expect(slept).toBeVisible()
  await api.activities.archive({ id: idOf(list, '仕事') })
  const answer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/changeActivity', async (route) => {
    const response = await route.fetch()
    await answer.promise
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: '元に戻す' }).click()
  await page.getByRole('button', { name: '完了' }).click()
  await page.getByRole('tab', { name: '記録' }).click()
  await dayLink(page, day).click()
  const meal = dialog.getByRole('button', { name: /^食事 7:00 – / })
  await meal.click()
  await expect(meal).toHaveAttribute('aria-expanded', 'true')
  const writing = dialog.getByText('反映しています…')
  await expect(writing).toBeVisible()
  answer.resolve()
  await expect(writing).toBeHidden()

  // Act
  await slept.click()

  // Assert: the record's panel opens on the notice the refusal raised.
  await expect(slept).toHaveAttribute('aria-expanded', 'true')
  await expect(dialog.getByRole('alert')).toHaveText(
    '前の活動はアーカイブ済みのため、元に戻せません',
  )
})

test('a split whose answer lands after midnight selects nothing on the new day, even the half that runs into it', async ({
  page,
}) => {
  test.skip(
    Date.now() - at(today(), 0).getTime() < 2 * 60_000,
    'the Tokyo day is under two minutes old, so no current state is long enough to split',
  )
  // Arrange: today's sheet splits the running 仕事, and the answer is held back past midnight. The later half runs on, so
  // the new day lists it as the record carried in, under the id the split's answer names.
  await openTodayWorkSinceMidnight(page)
  await page.clock.install()
  const answer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/splitInHalf', async (route) => {
    const response = await route.fetch()
    await answer.promise
    await route.fulfill({ response })
  })
  await page.goto('/correction')
  const dialog = page.getByRole('dialog', { name: '今日の記録を訂正' })
  await dialog.getByRole('button', { name: /^仕事 0:00 – / }).click()
  await dialog.getByRole('button', { name: '半分で分割' }).click()

  // Act: the clock passes midnight, so the sheet follows the new day on its next second's tick, and then the split's answer
  // lands. Setting the time fires no timer, so the split's 30 s deadline does not run out on the way.
  const newDay = shift(today(), 1)
  await page.clock.setSystemTime(new Date(`${newDay}T00:00:30+09:00`))
  // Only the new day lists 仕事 at under 2 minutes: the skip above keeps the old day's running row at 2 minutes or more.
  const carriedIn = dialog.getByRole('button', {
    name: /^仕事 0:00 – いま [01]m$/,
  })
  await expect(carriedIn).toBeVisible()
  // The line stays while the split is in flight, its re-read included, and goes once it settles; the selection its answer
  // would set runs as it settles, so the assertions below come after it.
  const writing = dialog.getByText('反映しています…')
  await expect(writing).toBeVisible()
  answer.resolve()
  await expect(writing).toBeHidden()

  // Assert: the carried-in half is listed but not opened by an answer about yesterday.
  await expect(carriedIn).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled()
})

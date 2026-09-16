import { expect, test } from '@playwright/test'

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

test('undo joins a split row back into one', async ({ page }) => {
  // Arrange: yesterday 仕事 9:00, 休息 12:00, with 仕事 split at 10:30.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
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
  await api.switches.replaceDay({
    day: today(),
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

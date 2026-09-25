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

test('the week view shows the excluded day dashed and out of the average', async ({
  page,
}) => {
  // Arrange: 仕事 9 h three days ago, 10 h yesterday; nothing two days ago, so that day is 計測なし.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const threeDaysAgo = shift(today(), -3)
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: threeDaysAgo,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(threeDaysAgo, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(threeDaysAgo, 18) },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(yesterday, 8) },
      { activityId: idOf(list, '睡眠'), startedAt: at(yesterday, 18) },
    ],
  })

  // Act
  await page.getByRole('tab', { name: '記録' }).click()

  // Assert: 仕事's row reads 19 h over the three measured days (today counts) = 6h 20m; over four calendar days it would read 4h 45m.
  // Scoped to that row: 睡眠 runs from yesterday 18:00 to now, so around 00:20 JST its total reads 6h 20m as well.
  await expect(page.getByRole('heading', { name: '記録' })).toBeVisible()
  const work = page.getByText('仕事', { exact: true }).locator('..')
  await expect(work.getByText('19h 00m')).toBeVisible()
  await expect(work.getByText('6h 20m')).toBeVisible()
  await expect(page.getByText('3 / 7日')).toBeVisible()
  await expect(page.getByText('2日', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('link', { name: /アプリを使わなかった 1日/ }),
  ).toBeVisible()
  const excluded = page.getByRole('link', { name: /計測なし/ })
  await expect(excluded).toBeVisible()
  await expect(excluded).toHaveCount(1)
  await expect(excluded.locator('div').first()).toHaveCSS(
    'border-top-style',
    'dashed',
  )
  // The dash is drawn in `sub`, the tone of the day's own weekday label, so it clears 3:1 against the card
  const sub = await excluded
    .locator('div')
    .last()
    .evaluate((el) => getComputedStyle(el).color)
  await expect(excluded.locator('div').first()).toHaveCSS(
    'border-top-color',
    sub,
  )
  // The wind glyph marks detox days only: neither the excluded day nor the measured ones carry it.
  await expect(page.getByTestId('detox-glyph')).toHaveCount(0)
})

test('days a detox runs through without a tap are outlined as detox, keep the streak and are not counted as unused', async ({
  page,
}) => {
  // Arrange: 仕事 at 9:00 three days ago, detox from 20:00 that evening; today's 家事 tap (signUp) ends it, so the two days
  // between have no tap of their own.
  await signUp(page)
  const api = await apiAs(page)
  const list = await api.activities.list()
  const threeDaysAgo = shift(today(), -3)
  await api.switches.replaceDay({
    day: threeDaysAgo,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(threeDaysAgo, 9) },
      { activityId: null, startedAt: at(threeDaysAgo, 20) },
    ],
  })

  // Act
  await page.getByRole('tab', { name: '記録' }).click()

  // Assert: both untapped days read as detox, not 計測なし, and count toward the measured days and the streak. Picked by the wind
  // glyph, since the worked day's label also reads its detox part.
  await expect(page.getByRole('heading', { name: '記録' })).toBeVisible()
  const detoxDays = page
    .getByRole('link')
    .filter({ has: page.getByTestId('detox-glyph') })
  await expect(detoxDays).toHaveCount(2)
  await expect(detoxDays.first()).toBeVisible()
  await expect(detoxDays.first()).toHaveAccessibleName(
    /^\d+月\d+日（.）・detox の日 24h 00m$/,
  )
  await expect(detoxDays.last()).toBeVisible()
  await expect(detoxDays.last()).toHaveAccessibleName(
    /^\d+月\d+日（.）・detox の日 24h 00m$/,
  )
  await expect(page.getByRole('link', { name: /計測なし/ })).toHaveCount(0)
  await expect(page.getByText('4 / 7日')).toBeVisible()
  await expect(page.getByText('4日', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('link', { name: /アプリを使わなかった/ }),
  ).toHaveCount(0)
})

test('a day spent in detox is outlined solid in sub with the wind glyph, named detox, and opens its correction sheet', async ({
  page,
}) => {
  // Arrange: yesterday one tap into detox at 9:00; today's 家事 tap (signUp) closes it, so the day is measured with nothing to stack
  await signUp(page)
  const api = await apiAs(page)
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: null, startedAt: at(yesterday, 9) }],
  })

  // Act
  await page.getByRole('tab', { name: '記録' }).click()

  // Assert: the day reads as detox rather than 計測なし: a solid outline (dashed is kept for 「点線の日」) in the `sub` tone of
  // its own weekday label, with the wind glyph inside, and its label reads the 15 h of detox
  await expect(page.getByRole('heading', { name: '記録' })).toBeVisible()
  const dayName = `${Number(yesterday.slice(5, 7))}月${Number(yesterday.slice(8))}日`
  const detox = page.getByRole('link', {
    name: new RegExp(`^${dayName}（.）・detox の日 15h 00m$`),
  })
  await expect(detox).toHaveCount(1)
  await expect(page.getByRole('link', { name: /計測なし/ })).toHaveCount(0)
  const track = detox.locator('div').first()
  // RN-web defaults every View to a solid style, so the width is what proves the outline is drawn.
  await expect(track).toHaveCSS('border-top-style', 'solid')
  await expect(track).toHaveCSS('border-top-width', '1px')
  await expect(detox.getByTestId('detox-glyph').locator('svg')).toBeVisible()
  const sub = await detox
    .locator('div')
    .last()
    .evaluate((el) => getComputedStyle(el).color)
  await expect(track).toHaveCSS('border-top-color', sub)
  // On web the glyph's stroke is currentColor, so it has to inherit the same `sub` or it turns black on dark
  await expect(detox.getByTestId('detox-glyph').locator('path')).toHaveCSS(
    'stroke',
    sub,
  )

  // The outlined day still opens the correction sheet, listing the detox span
  await detox.click()
  await expect(
    page.getByRole('dialog', { name: /の記録を訂正$/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'detox 9:00 – 24:00 15h 00m' }),
  ).toBeVisible()
})

test('a day worked then spent in detox draws its detox part as a sub outline on top of the work, and 状態別 lists detox', async ({
  page,
}) => {
  // Arrange: yesterday 仕事 from 9:00, detox from 18:00; today's 家事 tap (signUp) closes the detox
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
      { activityId: null, startedAt: at(yesterday, 18) },
    ],
  })

  // Act
  await page.getByRole('tab', { name: '記録' }).click()

  // Assert: yesterday stays a plain day (no detox outline or glyph on the cell); its slices run bottom-up, 仕事 then detox, and
  // its label reads both times in that order
  await expect(page.getByRole('heading', { name: '記録' })).toBeVisible()
  const dayName = `${Number(yesterday.slice(5, 7))}月${Number(yesterday.slice(8))}日`
  const cell = page.getByRole('link', {
    name: new RegExp(`^${dayName}（.）・仕事 9h 00m・detox 6h 00m$`),
  })
  await expect(cell).toBeVisible()
  await expect(cell.getByTestId('detox-glyph')).toHaveCount(0)
  const track = cell.locator('div').first()
  await expect(track).toHaveCSS('border-top-width', '0px')
  const slices = track.locator(':scope > div')
  await expect(slices).toHaveCount(2)
  // RN-web defaults every View to a solid style, so the width is what proves the outline is drawn
  await expect(slices.first()).toHaveCSS('border-top-width', '0px')
  const detoxPart = slices.last()
  await expect(detoxPart).toHaveCSS('border-top-width', '1px')
  await expect(detoxPart).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  const sub = await cell
    .locator('div')
    .last()
    .evaluate((el) => getComputedStyle(el).color)
  await expect(detoxPart).toHaveCSS('border-top-color', sub)

  // 状態別 lists detox (its order and figures are pinned by the unit test)
  const breakdown = page.getByText('状態別', { exact: true }).locator('../..')
  await expect(breakdown.getByText('detox', { exact: true })).toBeVisible()
})

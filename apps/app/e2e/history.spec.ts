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
    rows: [
      { activityId: idOf(list, '仕事'), startedAt: at(threeDaysAgo, 9) },
      { activityId: idOf(list, '休息'), startedAt: at(threeDaysAgo, 18) },
    ],
  })
  await api.switches.replaceDay({
    day: yesterday,
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
})

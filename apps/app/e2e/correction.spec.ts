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

test('splitting the current state shows on Home without a reload', async ({
  page,
}) => {
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
  await expect(dialog.getByRole('button', { name: /^仕事 / })).toHaveCount(2)
  await page.getByRole('button', { name: '完了' }).click()

  // Assert: Home counts the new row as a switch straight away.
  await expect(page).toHaveURL('/')
  await expect(page.getByText(/今日 1 回切替$/)).toBeVisible()
})

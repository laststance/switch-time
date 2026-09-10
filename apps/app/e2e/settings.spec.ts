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

test('cycling a color on 家事 persists after reload and shows on the Home button', async ({
  page,
}) => {
  // Arrange: 家事 is the current state after sign-up, so its Home button is the filled one.
  await signUp(page)
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('link', { name: '活動項目' }).click()
  await expect(page.getByRole('dialog', { name: '活動項目' })).toBeVisible()
  // The current state cannot be archived; any other row can.
  await expect(
    page.getByRole('button', { name: '家事をアーカイブ' }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: '仕事をアーカイブ' }),
  ).toBeEnabled()

  // Act: one step along the palette (#E0A431 → #3B7BD9), then a full reload.
  const dot = page.getByRole('button', { name: '家事の色を変える' })
  await dot.click()
  const swatch = dot.locator('div')
  await expect(swatch).toBeVisible()
  await expect(swatch).toHaveCSS('background-color', 'rgb(59, 123, 217)')
  await page.goto('/')

  // Assert
  const chore = page.getByRole('button', { name: '家事' })
  await expect(chore).toBeVisible()
  await expect(chore).toHaveCSS('background-color', 'rgb(59, 123, 217)')
})

test('switching appearance to dark applies immediately', async ({ page }) => {
  // Arrange: 明 first, so the assertion does not depend on the hour the run happens in.
  await signUp(page)
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('button', { name: '明' }).click()
  const bar = page.getByRole('tablist')
  await expect(bar).toBeVisible()
  await expect(bar).toHaveCSS('background-color', 'rgb(245, 242, 235)')

  // Act
  await page.getByRole('button', { name: '暗' }).click()

  // Assert: the chrome flips at once, and the choice is the server's after a reload.
  await expect(page.getByRole('button', { name: '暗' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(bar).toHaveCSS('background-color', 'rgb(17, 18, 22)')
  // The chrome flipped on the optimistic value; wait for the server before reloading on top of it.
  const api = await apiAs(page)
  await expect.poll(async () => (await api.settings.get()).theme).toBe('dark')
  await page.reload()
  await expect(page.getByRole('tablist')).toHaveCSS(
    'background-color',
    'rgb(17, 18, 22)',
  )
})

test('a manually excluded day returns from the 未使用日の扱い sheet and the idle threshold persists', async ({
  page,
}) => {
  // Arrange: yesterday excluded through the API (the app has no manual-exclusion entry point yet).
  await signUp(page)
  const api = await apiAs(page)
  const yesterday = shift(today(), -1)
  await api.excludedDays.exclude({ day: yesterday })
  await page.getByRole('tab', { name: '設定' }).click()
  await expect(
    page.getByRole('link', { name: '未使用日の自動除外' }),
  ).toContainText('オン · 無操作 12時間以上')
  await page.getByRole('link', { name: '未使用日の自動除外' }).click()
  await expect(
    page.getByRole('dialog', { name: '未使用日の扱い' }),
  ).toBeVisible()
  const row = page.getByRole('button', { name: /を戻す$/ })
  await expect(row).toBeVisible()
  await expect(row).toHaveCount(1)

  // Act
  await page.getByRole('button', { name: '8h' }).click()
  await row.click()

  // Assert
  await expect(page.getByText('8時間', { exact: true })).toBeVisible()
  await expect(page.getByText('除外中の日はありません')).toBeVisible()
  expect(
    await api.excludedDays.list({ from: yesterday, to: yesterday }),
  ).toEqual([])
  await expect
    .poll(async () => (await api.settings.get()).idleThresholdMinutes)
    .toBe(480)
})

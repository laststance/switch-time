import { expect, test } from '@playwright/test'

import { signUp } from './helpers'

test('wide windows get the 76px rail and its tabs switch screens', async ({
  page,
}) => {
  // Arrange
  await page.setViewportSize({ width: 1024, height: 860 })
  await signUp(page)
  const rail = page.getByRole('tablist')
  await expect(rail).toBeVisible()
  expect(await rail.boundingBox()).toMatchObject({ x: 0, width: 76 })

  // Act
  await page.getByRole('tab', { name: '記録' }).click()

  // Assert
  await expect(page).toHaveURL('/history')
  await expect(page.getByRole('heading', { name: '記録' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '記録' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('narrow windows get the 60px tab bar at the bottom', async ({ page }) => {
  // Arrange
  await page.setViewportSize({ width: 390, height: 844 })

  // Act
  await signUp(page)

  // Assert
  const bar = page.getByRole('tablist')
  await expect(bar).toBeVisible()
  expect(await bar.boundingBox()).toMatchObject({
    y: 784,
    width: 390,
    height: 60,
  })
})

test('the tabs work from the keyboard', async ({ page }) => {
  // Arrange
  await signUp(page)
  await page.getByRole('tab', { name: 'ホーム' }).focus()

  // Act
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  // Assert
  await expect(page).toHaveURL('/settings')
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
})

// ponytail: reached by URL (cold load, nothing beneath) until MVP-14 adds the in-app entry point; over-the-tabs was checked by hand.
test('a sheet route opens as a dialog and its ✕ returns home', async ({
  page,
}) => {
  // Arrange
  await signUp(page)

  // Act
  await page.goto('/correction')

  // Assert
  await expect(
    page.getByRole('dialog', { name: '今日の記録を訂正' }),
  ).toBeVisible()
  // Focus lands inside the dialog, so Tab and Escape start there instead of on the rail underneath.
  await expect(
    page.getByRole('dialog', { name: '今日の記録を訂正' }),
  ).toBeFocused()
  await page.getByRole('button', { name: '閉じる' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'いま' })).toBeVisible()
})

test('an unknown URL shows the not-found screen with a way home', async ({
  page,
}) => {
  // Arrange
  await signUp(page)

  // Act
  await page.goto('/nope')

  // Assert
  await expect(page.getByText('ページが見つかりません')).toBeVisible()
  await page.getByRole('link', { name: 'ホームへ戻る' }).click()
  await expect(page.getByRole('heading', { name: 'いま' })).toBeVisible()
})

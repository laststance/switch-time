import { expect, test } from '@playwright/test'

const password = 'correct-horse-battery'

test('a new user can sign up and lands on the first-launch screen', async ({
  page,
}) => {
  // Arrange
  const email = `e2e-${Date.now()}@example.com`
  await page.goto('/sign-up')

  // Act
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(password)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()

  // Assert
  await expect(
    page.getByRole('heading', { name: 'いま何をしている？' }),
  ).toBeVisible()
  await expect(page).toHaveURL('/')
})

test('signing out returns to sign-in and hides the app', async ({ page }) => {
  // Arrange
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').fill(`e2e-${Date.now()}@example.com`)
  await page.getByLabel('パスワード').fill(password)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await expect(
    page.getByRole('heading', { name: 'いま何をしている？' }),
  ).toBeVisible()

  // Act
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('button', { name: 'サインアウト' }).click()

  // Assert
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeVisible()
  await expect(page.getByText('いま')).toHaveCount(0)
})

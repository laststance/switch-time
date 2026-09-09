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

test('an existing account can sign back in after signing out', async ({
  page,
}) => {
  // Arrange
  const email = `e2e-${Date.now()}@example.com`
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(password)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await expect(page).toHaveURL('/')
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('button', { name: 'サインアウト' }).click()
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeVisible()

  // Act
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(password)
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(page).toHaveURL('/')
  await expect(page.getByText('いま').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'サインイン' })).toHaveCount(0)
})

test('an anonymous visitor comes back to the exact URL they opened after signing in', async ({
  page,
  browser,
}) => {
  // Arrange: an account made in one browser; a fresh anonymous browser opens a deep link with a query.
  const email = `e2e-${Date.now()}@example.com`
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(password)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await expect(page).toHaveURL('/')
  const anonymous = await (await browser.newContext()).newPage()
  await anonymous.goto('/?tab=week')
  await expect(anonymous).toHaveURL(/\/sign-in\?next=/)

  // Act
  await anonymous.getByLabel('メールアドレス').fill(email)
  await anonymous.getByLabel('パスワード').fill(password)
  await anonymous.getByRole('button', { name: 'サインイン' }).click()

  // Assert: the query survived the round trip through `next`.
  await expect(anonymous).toHaveURL('/?tab=week')
  await expect(anonymous.getByText('いま').first()).toBeVisible()
})

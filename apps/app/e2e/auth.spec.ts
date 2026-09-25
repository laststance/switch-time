import { expect, type Page, test } from '@playwright/test'

import {
  createAccount,
  PASSWORD,
  register,
  REGISTERED_NOTICE,
  uniqueEmail,
} from './helpers'

const signOut = async (page: Page): Promise<void> => {
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('button', { name: 'サインアウト' }).click()
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeVisible()
}

test('a new user signs up, signs in with the address already filled in, and lands on the first-launch screen', async ({
  page,
}) => {
  // Arrange
  const email = uniqueEmail()
  await register(page, email)

  // Act
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(
    page.getByRole('heading', { name: 'いま何をしている？' }),
  ).toBeVisible()
  await expect(page).toHaveURL('/')
})

test('after sign-up the sign-in screen says the account was made, fills in the address and focuses the password', async ({
  page,
}) => {
  // Arrange
  const email = uniqueEmail()

  // Act
  await register(page, email)

  // Assert
  await expect(page).toHaveURL(/\/sign-in/)
  await expect(page.getByRole('status')).toHaveText(REGISTERED_NOTICE)
  await expect(page.getByLabel('メールアドレス')).toHaveValue(email)
  const password = page.getByLabel('パスワード')
  await expect(password).toHaveValue('')
  await expect(password).toBeFocused()
  // A screen reader lands on the focused password field and reads the notice with it.
  await expect(password).toHaveAccessibleDescription(REGISTERED_NOTICE)
})

test('typing after sign-up hides the notice and keeps the address and every typed character', async ({
  page,
}) => {
  // Arrange
  const email = uniqueEmail()
  await register(page, email)

  // Act: straight into the focused field, as a user would.
  await page.keyboard.type('corr')

  // Assert
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByLabel('パスワード')).toHaveValue('corr')
  await expect(page.getByLabel('メールアドレス')).toHaveValue(email)
})

test('signing up with an address that already has an account looks the same, and the original password still signs in', async ({
  page,
}) => {
  // Arrange
  const email = await createAccount(page)
  await signOut(page)

  // Act
  await register(page, email, 'a different password')
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(page).toHaveURL('/')
  await expect(page.getByText('いま').first()).toBeVisible()
})

test('a wrong password after sign-up replaces the notice with the sign-in error', async ({
  page,
}) => {
  // Arrange
  await register(page, uniqueEmail())

  // Act
  await page.getByLabel('パスワード').fill('not the password')
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeVisible()
})

test('signing out returns to sign-in and hides the app', async ({ page }) => {
  // Arrange
  await createAccount(page)

  // Act
  await signOut(page)

  // Assert
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeVisible()
  await expect(page.getByText('いま')).toHaveCount(0)
})

test('an existing account can sign back in after signing out', async ({
  page,
}) => {
  // Arrange
  const email = await createAccount(page)
  await signOut(page)

  // Act
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(PASSWORD)
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
  const email = await createAccount(page)
  const anonymous = await (await browser.newContext()).newPage()
  await anonymous.goto('/?tab=week')
  await expect(anonymous).toHaveURL(/\/sign-in\?next=/)

  // Act
  await anonymous.getByLabel('メールアドレス').fill(email)
  await anonymous.getByLabel('パスワード').fill(PASSWORD)
  await anonymous.getByRole('button', { name: 'サインイン' }).click()

  // Assert: the query survived the round trip through `next`.
  await expect(anonymous).toHaveURL('/?tab=week')
  await expect(anonymous.getByText('いま').first()).toBeVisible()
})

test('an anonymous visitor who signs up instead still comes back to the URL they opened', async ({
  page,
}) => {
  // Arrange
  await page.goto('/?tab=week')
  await expect(page).toHaveURL(/\/sign-in\?next=/)
  await page.getByRole('link', { name: '新規登録はこちら' }).click()
  // Sign-up is pushed over sign-in, which stays mounted (hidden) underneath.
  const signUpForm = { visible: true }
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').filter(signUpForm).fill(uniqueEmail())
  await page.getByLabel('パスワード').filter(signUpForm).fill(PASSWORD)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await expect(page.getByRole('status')).toHaveText(REGISTERED_NOTICE)

  // Act: no filter here: sign-up must have left the stack, so exactly one password field remains.
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(page).toHaveURL('/?tab=week')
})

test('a signed-in user opening sign-in while the session is still loading never sees the form before going home', async ({
  page,
}) => {
  // Arrange: hold the first session answer after a reload.
  await createAccount(page)
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/auth/get-session**', async (route) => {
    await held
    await route.continue()
  })

  // Act
  await page.goto('/sign-in')

  // Assert
  await expect(page.getByLabel('パスワード')).toHaveCount(0)
  release()
  await expect(page).toHaveURL('/')
})

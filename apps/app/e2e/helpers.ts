import { expect, type Page } from '@playwright/test'

/**
 * Creates a fresh account through the UI and taps 家事 on the first-launch screen, so every shell test starts signed in on Home.
 * @example await signUp(page)
 */
export async function signUp(page: Page) {
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page
    .getByLabel('メールアドレス')
    .fill(
      `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    )
  await page.getByLabel('パスワード').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await page.getByRole('button', { name: '家事' }).click()
  await expect(
    page.getByRole('heading', { name: 'いま', exact: true }),
  ).toBeVisible()
}

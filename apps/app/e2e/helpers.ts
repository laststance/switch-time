import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { expect, type Page } from '@playwright/test'
import type { AppRouterClient } from '@switch-time/api'

const API_ORIGIN = 'http://localhost:8080'

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

/**
 * A typed API client for the account the page is signed in as, to seed fixtures (backdated days) the UI cannot create yet.
 * @example const api = await apiAs(page); await api.switches.replaceDay({ day, rows })
 */
export async function apiAs(page: Page): Promise<AppRouterClient> {
  const cookies = await page.context().cookies(API_ORIGIN)
  const cookie = cookies.map((row) => `${row.name}=${row.value}`).join('; ')
  const client: AppRouterClient = createORPCClient(
    new RPCLink({ url: `${API_ORIGIN}/api/rpc`, headers: { cookie } }),
  )
  return client
}

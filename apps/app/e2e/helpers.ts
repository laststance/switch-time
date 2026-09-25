import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { expect, type Page } from '@playwright/test'
import type { AppRouterClient } from '@switch-time/api'

// The same port playwright.config.ts boots (or reuses) the API on.
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT || '4100'}`

/**
 * Creates a fresh account through the UI and taps 家事 on the first-launch screen, so every shell test starts signed in on Home.
 * Returns once the server has stored that tap, so a test that reads or rewrites today through the API sees it.
 * @example await signUp(page)
 */
export async function signUp(page: Page): Promise<void> {
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page
    .getByLabel('メールアドレス')
    .fill(
      `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    )
  await page.getByLabel('パスワード').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  // Home shows the tap optimistically, before the server answers: without this wait, a seed read right after can miss it.
  const firstTapAnswer = page.waitForResponse((response) =>
    response.url().includes('/api/rpc/switches/switchTo'),
  )
  await page.getByRole('button', { name: '家事' }).click()
  expect((await firstTapAnswer).ok()).toBe(true)
  await expect(
    page.getByRole('heading', { name: 'いま', exact: true }),
  ).toBeVisible()
}

/**
 * A typed API client for the account the page is signed in as, to seed fixtures (backdated days) the UI cannot create yet.
 * @example const api = await apiAs(page); await api.switches.replaceDay({ day, timeZone: 'Asia/Tokyo', expected: [], rows })
 */
export async function apiAs(page: Page): Promise<AppRouterClient> {
  const cookies = await page.context().cookies(API_ORIGIN)
  const cookie = cookies.map((row) => `${row.name}=${row.value}`).join('; ')
  const client: AppRouterClient = createORPCClient(
    new RPCLink({ url: `${API_ORIGIN}/api/rpc`, headers: { cookie } }),
  )
  return client
}

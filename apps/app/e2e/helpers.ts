import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { expect, type Page } from '@playwright/test'
import type { AppRouterClient } from '@switch-time/api'

// The same port playwright.config.ts boots (or reuses) the API on.
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT || '4100'}`

/** The password every E2E account registers with. */
export const PASSWORD = 'correct-horse-battery'

/** What sign-in says after 登録, for a new address and for one that already has an account alike. */
export const REGISTERED_NOTICE = '登録しました。サインインしてください'

/**
 * An address no other test (or run) has used.
 * @example uniqueEmail() // => 'e2e-1790318481000-k3x9qa@example.com'
 */
export const uniqueEmail = (): string =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`

/**
 * Registers `email` through the sign-up screen and stops on the sign-in screen it leads to (the address filled in, the notice showing).
 * @example await register(page, 'a@example.com', 'another password')
 */
export async function register(
  page: Page,
  email: string,
  password = PASSWORD,
): Promise<void> {
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(password)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await expect(page.getByRole('status')).toHaveText(REGISTERED_NOTICE)
}

/**
 * Creates an account through the UI (sign-up, then sign-in with the address it fills in) and lands on the first-launch screen.
 * @returns the account's address
 * @example const email = await createAccount(page)
 */
export async function createAccount(page: Page): Promise<string> {
  const email = uniqueEmail()
  await register(page, email)
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'サインイン' }).click()
  await expect(
    page.getByRole('heading', { name: 'いま何をしている？' }),
  ).toBeVisible()
  return email
}

/**
 * Creates a fresh account through the UI and taps 家事 on the first-launch screen, so every shell test starts signed in on Home.
 * Returns once the server has stored that tap, so a test that reads or rewrites today through the API sees it.
 * @example await signUp(page)
 */
export async function signUp(page: Page): Promise<void> {
  await createAccount(page)
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

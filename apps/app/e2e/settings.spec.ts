import { expect, type Page, test } from '@playwright/test'

import { apiAs, signUp } from './helpers'

const rpcError = (code: string, status: number) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({
    json: { defined: false, code, status, message: code },
  }),
})

/** The zones this device remembers syncing, one per account (`src/lib/device-zone.ts` keeps them in `localStorage` on the web). */
const syncedZones = async (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('switch-time.synced-zone.'))
      .map((key) => localStorage.getItem(key)),
  )

/** The tab comes back to the foreground: the session, the queries and the device zone are read again. */
const foreground = async (page: Page) =>
  page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
  )

/**
 * Signs the page's browser context in as a second account made elsewhere, through the context's own requests: the cookie
 * changes under the running app, as a sign-in in another tab does, without a second app mounted to race the first.
 */
async function signInElsewhere(page: Page): Promise<void> {
  const email = `e2e-b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'correct-horse-battery'
  const headers = { origin: new URL(page.url()).origin }
  const request = page.context().request
  const signUpAnswer = await request.post('/api/auth/sign-up/email', {
    headers,
    data: { name: 'E2E B', email, password },
  })
  expect(signUpAnswer.ok()).toBe(true)
  const signInAnswer = await request.post('/api/auth/sign-in/email', {
    headers,
    data: { email, password },
  })
  expect(signInAnswer.ok()).toBe(true)
}

// The API seeds Asia/Tokyo, so the fixture is written in that zone (fixed +09:00, no DST) without importing the shared package.
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
    new Date(),
  )
const shift = (day: string, n: number) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10)

/** What {@link paintBrowserChrome} writes so Safari's URL bar matches 明／暗. */
const browserChrome = () => ({
  colorScheme: document.documentElement.style.colorScheme,
  themeColor: document
    .querySelector('meta[name="theme-color"]:not([media])')
    ?.getAttribute('content'),
  liveMedia: [
    ...document.querySelectorAll(
      'meta[name="theme-color"][media]:not([media="not all"])',
    ),
  ].map((el) => el.getAttribute('media')),
})

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
  await expect
    .poll(async () => page.evaluate(browserChrome))
    .toEqual({
      colorScheme: 'light',
      themeColor: '#f5f2eb',
      liveMedia: [],
    })

  // Act
  await page.getByRole('button', { name: '暗' }).click()

  // Assert: the chrome flips at once, and the choice is the server's after a reload.
  await expect(page.getByRole('button', { name: '暗' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(bar).toHaveCSS('background-color', 'rgb(17, 18, 22)')
  await expect
    .poll(async () => page.evaluate(browserChrome))
    .toEqual({
      colorScheme: 'dark',
      themeColor: '#111216',
      liveMedia: [],
    })
  // The chrome flipped on the optimistic value; wait for the server before reloading on top of it.
  const api = await apiAs(page)
  await expect.poll(async () => (await api.settings.get()).theme).toBe('dark')
  await page.reload()
  const reloadedBar = page.getByRole('tablist')
  await expect(reloadedBar).toBeVisible()
  await expect(reloadedBar).toHaveCSS('background-color', 'rgb(17, 18, 22)')
  await expect
    .poll(async () => page.evaluate(browserChrome))
    .toEqual({
      colorScheme: 'dark',
      themeColor: '#111216',
      liveMedia: [],
    })
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
  const sheet = page.getByRole('dialog', { name: '未使用日の扱い' })
  await expect(sheet).toBeVisible()
  await expect(
    sheet.getByText('デトックスを続けた日は計測に入ります。', { exact: false }),
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

test('この端末に合わせる on 設定 takes the account’s zone back after another device set its own', async ({
  page,
}) => {
  // Arrange: this device (Asia/Tokyo) has synced the account; then another device stores UTC.
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  const api = await apiAs(page)
  await api.settings.update({ timeZone: 'UTC' })
  await page.reload()
  await page.getByRole('tab', { name: '設定' }).click()
  await expect(page.getByText('UTC · この端末は Asia/Tokyo')).toBeVisible()

  // Act
  await page.getByRole('button', { name: 'この端末に合わせる' }).click()

  // Assert
  await expect(page.getByText('Asia/Tokyo · この端末と同じ')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'この端末に合わせる' }),
  ).toHaveCount(0)
  await expect
    .poll(async () => (await api.settings.get()).timeZone)
    .toBe('Asia/Tokyo')
})

test('a failed take-back on 設定 says so and keeps the button, and the account keeps the other device’s zone', async ({
  page,
}) => {
  // Arrange
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  const api = await apiAs(page)
  await api.settings.update({ timeZone: 'UTC' })
  await page.reload()
  await page.getByRole('tab', { name: '設定' }).click()
  await expect(page.getByText('UTC · この端末は Asia/Tokyo')).toBeVisible()
  await page.route('**/api/rpc/settings/update', async (route) =>
    route.fulfill(rpcError('INTERNAL_SERVER_ERROR', 500)),
  )

  // Act
  await page.getByRole('button', { name: 'この端末に合わせる' }).click()

  // Assert
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: '保存できませんでした。もう一度お試しください' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'この端末に合わせる' }),
  ).toBeEnabled()
  expect((await api.settings.get()).timeZone).toBe('UTC')
})

test('a device zone change while the app stays open reaches the account and 設定 without a relaunch', async ({
  page,
}) => {
  // Arrange: the test decides what the browser reports as its zone, starting from the config's Asia/Tokyo.
  await page.addInitScript(() => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions
    Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions(
      this: Intl.DateTimeFormat,
    ) {
      const options = original.call(this)
      const override = localStorage.getItem('e2e.device-zone')
      return override ? { ...options, timeZone: override } : options
    }
  })
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  const api = await apiAs(page)
  await page.getByRole('tab', { name: '設定' }).click()
  await expect(page.getByText('Asia/Tokyo · この端末と同じ')).toBeVisible()

  // Act: the device moves to UTC, then the app comes back to the foreground.
  await page.evaluate(() => localStorage.setItem('e2e.device-zone', 'UTC'))
  await foreground(page)

  // Assert: this device moved, so its new zone is written; the row follows.
  await expect.poll(async () => (await api.settings.get()).timeZone).toBe('UTC')
  await expect(page.getByText('UTC · この端末と同じ')).toBeVisible()
})

test('after a switch to another account, this device writes its zone to that account instead of remembering the previous account’s', async ({
  page,
}) => {
  // Arrange: account A synced Asia/Tokyo here; account B, made elsewhere, holds UTC and never synced on this device.
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  await signInElsewhere(page)
  const accountB = await apiAs(page)
  await accountB.settings.update({ timeZone: 'UTC' })
  // Settings reads are held back, so the session turns to B while A's row is still the cached one.
  await page.route('**/api/rpc/settings/get**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await route.continue().catch(() => undefined)
  })
  // Better Auth refetches the session on a foreground only 5 s after its last session request.
  await page.waitForTimeout(6_000)

  // Act
  await foreground(page)

  // Assert
  await expect
    .poll(async () => (await accountB.settings.get()).timeZone, {
      timeout: 20_000,
    })
    .toBe('Asia/Tokyo')
})

// The browser's zone, not the seeded one, must own the day boundaries; only this block leaves the config's Asia/Tokyo.
test.describe('device time zone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  test('a new account follows the device time zone without any tap', async ({
    page,
  }) => {
    // Arrange: the account is created on the API's default zone (Asia/Tokyo).
    await signUp(page)
    const api = await apiAs(page)

    // Act: nothing; the root layout writes the zone once the settings row has loaded.

    // Assert
    await expect
      .poll(async () => (await api.settings.get()).timeZone)
      .toBe('America/Los_Angeles')
  })

  test('a failed zone write for one account does not stop the zone sync for the next account signed in on this device', async ({
    page,
  }) => {
    // Arrange: account A's automatic write (Asia/Tokyo → America/Los_Angeles) fails.
    await page.route('**/api/rpc/settings/update', async (route) =>
      route.fulfill(rpcError('INTERNAL_SERVER_ERROR', 500)),
    )
    const failedWrite = page.waitForResponse((response) =>
      response.url().includes('/api/rpc/settings/update'),
    )
    await signUp(page)
    expect((await failedWrite).status()).toBe(500)
    await page.unroute('**/api/rpc/settings/update')
    await signInElsewhere(page)
    const accountB = await apiAs(page)
    // Better Auth refetches the session on a foreground only 5 s after its last session request.
    await page.waitForTimeout(6_000)

    // Act
    await foreground(page)

    // Assert: B still holds the API's default zone until this device writes its own.
    await expect
      .poll(async () => (await accountB.settings.get()).timeZone, {
        timeout: 20_000,
      })
      .toBe('America/Los_Angeles')
  })
})

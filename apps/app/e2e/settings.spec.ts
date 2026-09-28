import { expect, type Page, test } from '@playwright/test'

import { apiAs, signUp } from './helpers'

const rpcError = (code: string, status: number) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({
    json: { defined: false, code, status, message: code },
  }),
})

/** An API refusal as oRPC encodes it: the error with its `data` (`{ reason }`), which the app reads to say why in Japanese. */
const rpcRefusal = (code: string, status: number, reason: string) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({
    json: { defined: false, code, status, message: code, data: { reason } },
  }),
})

/** The zones this device remembers syncing, one per account (the store persists its `syncedZone` slice to `localStorage` on the web). */
const syncedZones = async (page: Page) =>
  page.evaluate(() => {
    const persisted = localStorage.getItem('switch-time.device')
    if (!persisted) return []
    const { state } = JSON.parse(persisted) as {
      state: { syncedZone: { byAccount: Record<string, string> } }
    }
    return Object.values(state.syncedZone.byAccount)
  })

/** The tab comes back to the foreground: the session, the queries and the device zone are read again. */
const foreground = async (page: Page) =>
  page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
  )

/**
 * Brings the tab to the foreground until the app has read the session as `email`. Better Auth refetches the session on a
 * foreground only 5 s after its last session request, so one foreground right after a sign-in elsewhere may read nothing.
 */
async function foregroundUntilSessionIs(
  page: Page,
  email: string,
): Promise<void> {
  let sessionRead = false
  void page
    .waitForResponse(
      async (response) =>
        response.url().includes('/api/auth/get-session') &&
        (await response.text()).includes(email),
      { timeout: 30_000 },
    )
    .then(() => {
      sessionRead = true
    })
  await expect
    .poll(
      async () => {
        if (!sessionRead) await foreground(page)
        return sessionRead
      },
      { timeout: 30_000, intervals: [1_000] },
    )
    .toBe(true)
}

/**
 * Signs the page's browser context in as a second account made elsewhere, through the context's own requests: the cookie
 * changes under the running app, as a sign-in in another tab does, without a second app mounted to race the first.
 * @returns The second account's email, which {@link foregroundUntilSessionIs} waits for.
 */
async function signInElsewhere(page: Page): Promise<string> {
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
  return email
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

test('＋ 項目を追加 on a full list of 100 says the cap under the list instead of doing nothing', async ({
  page,
}) => {
  // Arrange: the six seeded activities plus 94 more reach the cap.
  await signUp(page)
  const api = await apiAs(page)
  for (let index = 0; index < 94; index += 1)
    await api.activities.create({
      name: `項目${index}`,
      color: '#E0A431',
      iconKey: 'home',
      targetHours: null,
    })
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('link', { name: '活動項目' }).click()
  const sheet = page.getByRole('dialog', { name: '活動項目' })
  await expect(
    sheet.getByRole('button', { name: '＋ 項目を追加' }),
  ).toBeEnabled()

  // Act
  await sheet.getByRole('button', { name: '＋ 項目を追加' }).click()

  // Assert
  await expect(
    sheet.getByRole('alert').filter({
      hasText: '項目は 100 個までです。使わない項目をアーカイブしてください',
    }),
  ).toBeVisible()
  expect(
    (await api.activities.list()).filter((row) => row.archivedAt === null),
  ).toHaveLength(100)
})

test('an archived activity is listed under アーカイブ済み, and 戻す puts it back at the end of the list and on Home', async ({
  page,
}) => {
  // Arrange
  await signUp(page)
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('link', { name: '活動項目' }).click()
  const sheet = page.getByRole('dialog', { name: '活動項目' })
  await sheet.getByRole('button', { name: '休息をアーカイブ' }).click()
  await expect(
    sheet.getByRole('heading', { name: 'アーカイブ済み' }),
  ).toBeVisible()
  await expect(sheet.getByRole('button', { name: '休息を戻す' })).toBeEnabled()

  // Act
  await sheet.getByRole('button', { name: '休息を戻す' }).click()

  // Assert: back as the last live row, and the section goes with nothing left in it.
  await expect(
    sheet.getByRole('button', { name: '休息をアーカイブ' }),
  ).toBeVisible()
  await expect(
    sheet.getByRole('heading', { name: 'アーカイブ済み' }),
  ).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: '休息を下へ' })).toBeDisabled()
  await page.goto('/')
  await expect(page.getByRole('button', { name: '休息' })).toBeVisible()
})

test('an add whose answer timed out asks to check the list, and the next press clears the line', async ({
  page,
}) => {
  // Arrange
  await signUp(page)
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('link', { name: '活動項目' }).click()
  const sheet = page.getByRole('dialog', { name: '活動項目' })
  await page.route('**/api/rpc/activities/create', async (route) =>
    route.fulfill(rpcError('GATEWAY_TIMEOUT', 504)),
  )
  await sheet.getByRole('button', { name: '＋ 項目を追加' }).click()
  const line = sheet.getByRole('alert').filter({
    hasText: '反映されたか分かりませんでした。一覧で確かめてください',
  })
  await expect(line).toBeVisible()

  // Act
  await sheet.getByRole('button', { name: '仕事を下へ' }).click()

  // Assert
  await expect(line).toHaveCount(0)
})

test('戻す while 100 activities are live says the cap and keeps the row under アーカイブ済み', async ({
  page,
}) => {
  // Arrange: 休息 is archived, then the five other seeded activities plus 95 more reach the cap.
  await signUp(page)
  const api = await apiAs(page)
  const rest = (await api.activities.list()).find((row) => row.name === '休息')
  if (!rest) throw new Error('the seeded 休息 is missing')
  await api.activities.archive({ id: rest.id })
  for (let index = 0; index < 95; index += 1)
    await api.activities.create({
      name: `項目${index}`,
      color: '#E0A431',
      iconKey: 'home',
      targetHours: null,
    })
  // The list read at sign-up is still fresh for the app, so it is read again with the writes above in it.
  await page.reload()
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('link', { name: '活動項目' }).click()
  const sheet = page.getByRole('dialog', { name: '活動項目' })
  await expect(sheet.getByRole('button', { name: '休息を戻す' })).toBeEnabled()

  // Act
  await sheet.getByRole('button', { name: '休息を戻す' }).click()

  // Assert
  await expect(
    sheet.getByRole('alert').filter({
      hasText: '項目は 100 個までです。使わない項目をアーカイブしてください',
    }),
  ).toBeVisible()
  await expect(
    sheet.getByRole('heading', { name: 'アーカイブ済み' }),
  ).toBeVisible()
  await expect(sheet.getByRole('button', { name: '休息を戻す' })).toBeVisible()
  expect(
    (await api.activities.list())
      .filter((row) => row.archivedAt !== null)
      .map((row) => row.name),
  ).toEqual(['休息'])
})

test('🗑 on an activity another device has just started says it cannot be archived and keeps the row in the list', async ({
  page,
}) => {
  // Arrange: the API answers the archive as it does once 仕事 is running elsewhere.
  await signUp(page)
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('link', { name: '活動項目' }).click()
  const sheet = page.getByRole('dialog', { name: '活動項目' })
  await page.route('**/api/rpc/activities/archive', async (route) =>
    route.fulfill(rpcRefusal('CONFLICT', 409, 'in-use')),
  )

  // Act
  await sheet.getByRole('button', { name: '仕事をアーカイブ' }).click()

  // Assert
  await expect(
    sheet.getByRole('alert').filter({
      hasText: '計測中の項目と最後の 1 つはアーカイブできません',
    }),
  ).toBeVisible()
  await expect(
    sheet.getByRole('button', { name: '仕事をアーカイブ' }),
  ).toBeVisible()
  await expect(
    sheet.getByRole('heading', { name: 'アーカイブ済み' }),
  ).toHaveCount(0)
})

test('▲▼ answered busy asks to wait and try again', async ({ page }) => {
  // Arrange: the account already has its cap of writes in flight.
  await signUp(page)
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('link', { name: '活動項目' }).click()
  const sheet = page.getByRole('dialog', { name: '活動項目' })
  await page.route('**/api/rpc/activities/reorder', async (route) =>
    route.fulfill(rpcRefusal('TOO_MANY_REQUESTS', 429, 'busy')),
  )

  // Act
  await sheet.getByRole('button', { name: '仕事を下へ' }).click()

  // Assert
  await expect(
    sheet.getByRole('alert').filter({
      hasText: '処理が混み合っています。少し待ってからもう一度お試しください',
    }),
  ).toBeVisible()
})

test('🗑 on another row after a refused 戻す clears the refusal line', async ({
  page,
}) => {
  // Arrange: 休息 is archived, and its 戻す is refused for the cap.
  await signUp(page)
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('link', { name: '活動項目' }).click()
  const sheet = page.getByRole('dialog', { name: '活動項目' })
  await sheet.getByRole('button', { name: '休息をアーカイブ' }).click()
  await page.route('**/api/rpc/activities/unarchive', async (route) =>
    route.fulfill(rpcRefusal('CONFLICT', 409, 'too-many-activities')),
  )
  await sheet.getByRole('button', { name: '休息を戻す' }).click()
  await expect(
    sheet.getByRole('alert').filter({
      hasText: '項目は 100 個までです。使わない項目をアーカイブしてください',
    }),
  ).toBeVisible()

  // Act
  await sheet.getByRole('button', { name: '仕事をアーカイブ' }).click()

  // Assert: 仕事 joins 休息 under アーカイブ済み, and no line is left.
  await expect(sheet.getByRole('button', { name: '仕事を戻す' })).toBeVisible()
  await expect(sheet.getByRole('alert')).toHaveCount(0)
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
  ).toContainText('オン · 無操作 16時間以上')
  await page.getByRole('link', { name: '未使用日の自動除外' }).click()
  const sheet = page.getByRole('dialog', { name: '未使用日の扱い' })
  await expect(sheet).toBeVisible()
  // The hint opens with the rule itself: an untapped day leaves the averages, and the streak ends at it rather than skipping it
  await expect(
    sheet.getByText(
      '一度も切り替えなかった日は平均から外し、連続記録もその日で途切れます。',
      { exact: false },
    ),
  ).toBeVisible()
  await expect(
    sheet.getByText(
      'デトックスを続けた日は、始めた翌日から7日間は計測に入り、その後は「切替なし」として外します。',
      { exact: false },
    ),
  ).toBeVisible()
  // The hint also names the way back after the week: a detox re-tap counts its own day and starts another 7 days.
  await expect(
    sheet.getByText(
      '7日を過ぎてからデトックスを押し直すと、その日から計測に戻り、翌日からまた7日間計測に入ります。',
      { exact: false },
    ),
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

test('pressing この端末に合わせる again after a failed take-back clears the failure line once it lands', async ({
  page,
}) => {
  // Arrange: the first take-back fails, and the connection is back for the second.
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  const api = await apiAs(page)
  await api.settings.update({ timeZone: 'UTC' })
  await page.reload()
  await page.getByRole('tab', { name: '設定' }).click()
  await page.route('**/api/rpc/settings/update', async (route) =>
    route.fulfill(rpcError('INTERNAL_SERVER_ERROR', 500)),
  )
  await page.getByRole('button', { name: 'この端末に合わせる' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.unroute('**/api/rpc/settings/update')

  // Act
  await page.getByRole('button', { name: 'この端末に合わせる' }).click()

  // Assert
  await expect(page.getByText('Asia/Tokyo · この端末と同じ')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect
    .poll(async () => (await api.settings.get()).timeZone)
    .toBe('Asia/Tokyo')
})

test('この端末に合わせる waits while another settings change is still being saved', async ({
  page,
}) => {
  // Arrange: another device set UTC, and a 外観 change is held in flight.
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  const api = await apiAs(page)
  await api.settings.update({ timeZone: 'UTC' })
  await page.reload()
  await page.getByRole('tab', { name: '設定' }).click()
  await expect(page.getByText('UTC · この端末は Asia/Tokyo')).toBeVisible()
  let releaseWrite = (): void => undefined
  const writeHeld = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  await page.route('**/api/rpc/settings/update', async (route) => {
    await writeHeld
    await route.continue().catch(() => undefined)
  })

  // Act
  await page.getByRole('button', { name: '暗' }).click()

  // Assert: the take-back is off while the 外観 write is out, and back once it lands.
  await expect(
    page.getByRole('button', { name: 'この端末に合わせる' }),
  ).toBeDisabled()
  releaseWrite()
  await expect(
    page.getByRole('button', { name: 'この端末に合わせる' }),
  ).toBeEnabled()
})

test('a 外観 tap still on its way when another tab signs in someone else is refused, not saved into that account', async ({
  page,
}) => {
  // Arrange: account A's zone is synced, so the only settings write left is the 外観 tap, held until B has signed in.
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  const accountA = await apiAs(page)
  await page.getByRole('tab', { name: '設定' }).click()
  await expect(page.getByRole('button', { name: '暗' })).toBeVisible()
  let releaseWrite = (): void => undefined
  const writeHeld = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  await page.route('**/api/rpc/settings/update', async (route) => {
    await writeHeld
    await route.continue().catch(() => undefined)
  })
  const writeAnswered = page.waitForResponse('**/api/rpc/settings/update')

  // Act
  await page.getByRole('button', { name: '暗' }).click()
  await signInElsewhere(page)
  const accountB = await apiAs(page)
  releaseWrite()

  // Assert: the API refuses the tap for A's screen now that the cookie is B's, and neither account turned dark.
  expect((await writeAnswered).status()).toBe(409)
  expect((await accountB.settings.get()).theme).toBe('auto')
  expect((await accountA.settings.get()).theme).toBe('auto')
})

test('a failed take-back’s line does not follow the device into the next account signed in on it', async ({
  page,
}) => {
  // Arrange: every settings write fails. Account A's take-back fails; account B, made elsewhere, holds UTC.
  await page.route('**/api/rpc/settings/update', async (route) =>
    route.fulfill(rpcError('INTERNAL_SERVER_ERROR', 500)),
  )
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  const accountA = await apiAs(page)
  await accountA.settings.update({ timeZone: 'UTC' })
  await page.reload()
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('button', { name: 'この端末に合わせる' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  const emailB = await signInElsewhere(page)
  const accountB = await apiAs(page)
  await accountB.settings.update({ timeZone: 'UTC' })

  // Act
  await foregroundUntilSessionIs(page, emailB)

  // Assert: B's row names both zones, with no failure line from A's tap.
  await expect(page.getByText('UTC · この端末は Asia/Tokyo')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
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
  const emailB = await signInElsewhere(page)
  const accountB = await apiAs(page)
  await accountB.settings.update({ timeZone: 'UTC' })
  // Settings reads are held until the app has read the session as B, so the session turns to B while A's row is still the
  // cached one, however long that session read takes.
  let releaseSettingsReads = (): void => undefined
  const settingsReadsHeld = new Promise<void>((resolve) => {
    releaseSettingsReads = resolve
  })
  await page.route('**/api/rpc/settings/get**', async (route) => {
    await settingsReadsHeld
    await route.continue().catch(() => undefined)
  })

  // Act
  await foregroundUntilSessionIs(page, emailB)
  releaseSettingsReads()

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
    const emailB = await signInElsewhere(page)
    const accountB = await apiAs(page)

    // Act
    await foregroundUntilSessionIs(page, emailB)

    // Assert: B still holds the API's default zone until this device writes its own.
    await expect
      .poll(async () => (await accountB.settings.get()).timeZone, {
        timeout: 20_000,
      })
      .toBe('America/Los_Angeles')
  })

  test('a zone write that failed for an account is sent again once that account signs in on this device again', async ({
    page,
  }) => {
    // Arrange: account A's automatic write fails; B, made elsewhere, already holds the device's zone, so its turn writes nothing.
    await page.route('**/api/rpc/settings/update', async (route) =>
      route.fulfill(rpcError('INTERNAL_SERVER_ERROR', 500)),
    )
    const failedWrite = page.waitForResponse((response) =>
      response.url().includes('/api/rpc/settings/update'),
    )
    await signUp(page)
    expect((await failedWrite).status()).toBe(500)
    await page.unroute('**/api/rpc/settings/update')
    const accountA = await apiAs(page)
    const sessionA = await page.context().request.get('/api/auth/get-session')
    const emailA: string = (await sessionA.json()).user.email
    const emailB = await signInElsewhere(page)
    await (
      await apiAs(page)
    ).settings.update({
      timeZone: 'America/Los_Angeles',
    })
    await foregroundUntilSessionIs(page, emailB)
    await expect
      .poll(async () => syncedZones(page))
      .toEqual(['America/Los_Angeles'])

    // Act: A signs in on this device again.
    const signInAnswer = await page
      .context()
      .request.post('/api/auth/sign-in/email', {
        headers: { origin: new URL(page.url()).origin },
        data: { email: emailA, password: 'correct-horse-battery' },
      })
    expect(signInAnswer.ok()).toBe(true)
    await foregroundUntilSessionIs(page, emailA)

    // Assert: A still held the API's default zone; the sync writes the device's this time.
    await expect
      .poll(async () => (await accountA.settings.get()).timeZone, {
        timeout: 20_000,
      })
      .toBe('America/Los_Angeles')
  })
})

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

test('Escape pressed while renaming 家事 on the 活動項目 sheet closes it and keeps the new name', async ({
  page,
}) => {
  // Arrange
  await signUp(page)
  const api = await apiAs(page)
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('link', { name: '活動項目' }).click()
  const sheet = page.getByRole('dialog', { name: '活動項目' })
  await sheet.getByRole('textbox', { name: '家事の名前' }).fill('掃除')

  // Act
  await page.keyboard.press('Escape')

  // Assert
  await expect(sheet).toHaveCount(0)
  await expect
    .poll(async () =>
      (await api.activities.list()).map((activity) => activity.name),
    )
    .toContain('掃除')
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
  await expect(page.getByText('協定世界時 · この端末は 東京')).toBeVisible()

  // Act
  await page.getByRole('button', { name: 'この端末に合わせる' }).click()

  // Assert
  await expect(page.getByText('東京 · この端末と同じ')).toBeVisible()
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
  await expect(page.getByText('協定世界時 · この端末は 東京')).toBeVisible()
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
  await expect(page.getByText('東京 · この端末と同じ')).toBeVisible()
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
  await expect(page.getByText('協定世界時 · この端末は 東京')).toBeVisible()
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
  await expect(page.getByText('協定世界時 · この端末は 東京')).toBeVisible()
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
  await expect(page.getByText('東京 · この端末と同じ')).toBeVisible()

  // Act: the device moves to UTC, then the app comes back to the foreground.
  await page.evaluate(() => localStorage.setItem('e2e.device-zone', 'UTC'))
  await foreground(page)

  // Assert: this device moved, so its new zone is written; the row follows.
  await expect.poll(async () => (await api.settings.get()).timeZone).toBe('UTC')
  await expect(page.getByText('協定世界時 · この端末と同じ')).toBeVisible()
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

/** Opens the タイムゾーン sheet from 設定's row and waits for the account's zone to be checked. */
async function openZoneSheet(page: Page) {
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('link', { name: 'タイムゾーン' }).click()
  const sheet = page.getByRole('dialog', { name: 'タイムゾーン' })
  await expect(sheet.getByRole('button', { name: /^東京、/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  return sheet
}

test('picking ニューヨーク on the タイムゾーン sheet moves the account there, and 設定 names both zones after a reload', async ({
  page,
}) => {
  // Arrange
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  const api = await apiAs(page)
  const sheet = await openZoneSheet(page)

  // Act
  await sheet.getByRole('button', { name: /^ニューヨーク、/ }).click()

  // Assert
  await expect(sheet.getByText('ニューヨークに変更しました')).toBeVisible()
  await expect(
    sheet.getByRole('button', { name: /^ニューヨーク、/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet.getByRole('button', { name: /^東京、/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect
    .poll(async () => (await api.settings.get()).timeZone)
    .toBe('America/New_York')
  await sheet.getByRole('button', { name: '閉じる' }).click()
  await expect(page.getByText('ニューヨーク · この端末は 東京')).toBeVisible()
  await page.reload()
  await page.getByRole('tab', { name: '設定' }).click()
  await expect(page.getByText('ニューヨーク · この端末は 東京')).toBeVisible()
  expect((await api.settings.get()).timeZone).toBe('America/New_York')
})

test('a search on the タイムゾーン sheet narrows the list, and one that matches nothing offers 検索をクリア', async ({
  page,
}) => {
  // Arrange
  await signUp(page)
  const sheet = await openZoneSheet(page)
  const search = sheet.getByRole('textbox', { name: '都市・国名で検索' })
  const list = sheet.getByRole('group', { name: 'タイムゾーン' })

  // Act
  await search.fill('上海')

  // Assert
  await expect(list.getByRole('button', { name: /^上海、/ })).toBeVisible()
  await expect(list.getByRole('button')).toHaveCount(1)
  await search.fill('ぬぬぬ')
  await expect(sheet.getByText('一致する都市がありません')).toBeVisible()
  await sheet.getByRole('button', { name: '検索をクリア' }).click()
  await expect(search).toHaveValue('')
  await expect(list.getByRole('button', { name: /^東京、/ })).toBeVisible()
})

test('a pick that fails says so under the search and leaves the check on the account’s zone', async ({
  page,
}) => {
  // Arrange
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  const api = await apiAs(page)
  const sheet = await openZoneSheet(page)
  await page.route('**/api/rpc/settings/update', async (route) =>
    route.fulfill(rpcError('INTERNAL_SERVER_ERROR', 500)),
  )

  // Act
  await sheet.getByRole('button', { name: /^ニューヨーク、/ }).click()

  // Assert
  await expect(
    sheet.getByRole('alert').filter({
      hasText: 'ニューヨークに変更できませんでした。もう一度お試しください',
    }),
  ).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^東京、/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    sheet.getByRole('button', { name: /^ニューヨーク、/ }),
  ).toHaveAttribute('aria-pressed', 'false')
  expect((await api.settings.get()).timeZone).toBe('Asia/Tokyo')
})

test('while a pick is being saved the sheet says so and the other rows wait for it', async ({
  page,
}) => {
  // Arrange: the pick's write is held until the test lets it through.
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  const sheet = await openZoneSheet(page)
  let releaseWrite = (): void => undefined
  const writeHeld = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  await page.route('**/api/rpc/settings/update', async (route) => {
    await writeHeld
    await route.continue().catch(() => undefined)
  })

  // Act
  await sheet.getByRole('button', { name: /^ニューヨーク、/ }).click()

  // Assert
  await expect(sheet.getByText('ニューヨークに変更しています…')).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^東京、/ })).toBeDisabled()
  releaseWrite()
  await expect(sheet.getByText('ニューヨークに変更しました')).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^東京、/ })).toBeEnabled()
})

test('the タイムゾーン sheet’s rows wait while a 外観 change is still being saved', async ({
  page,
}) => {
  // Arrange: a 外観 change is held in flight when the sheet opens.
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  await page.getByRole('tab', { name: '設定' }).click()
  let releaseWrite = (): void => undefined
  const writeHeld = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  await page.route('**/api/rpc/settings/update', async (route) => {
    await writeHeld
    await route.continue().catch(() => undefined)
  })
  await page.getByRole('button', { name: '暗' }).click()

  // Act
  const sheet = await openZoneSheet(page)

  // Assert: a pick cannot queue behind the 外観 write, and the rows come back once it lands.
  await expect(
    sheet.getByRole('button', { name: /^ニューヨーク、/ }),
  ).toBeDisabled()
  releaseWrite()
  await expect(
    sheet.getByRole('button', { name: /^ニューヨーク、/ }),
  ).toBeEnabled()
})

test('a pick that lands after the sheet closed stays the account’s zone, and a device that had not synced its own zone does not write it over the pick', async ({
  page,
}) => {
  // Arrange: the device moves to UTC and its automatic write of UTC fails, so this device has not synced UTC.
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
  let releasePick = (): void => undefined
  const pickHeld = new Promise<void>((resolve) => {
    releasePick = resolve
  })
  const automaticWriteFailed = page.waitForResponse(
    async (response) =>
      response.url().includes('/api/rpc/settings/update') &&
      response.status() === 500,
  )
  await page.route('**/api/rpc/settings/update', async (route) => {
    // The automatic sync sends UTC; the pick sends New York and is held until the sheet has closed.
    if (route.request().postData()?.includes('"UTC"')) {
      await route.fulfill(rpcError('INTERNAL_SERVER_ERROR', 500))
      return
    }
    await pickHeld
    await route.continue().catch(() => undefined)
  })
  await page.evaluate(() => localStorage.setItem('e2e.device-zone', 'UTC'))
  await foreground(page)
  await automaticWriteFailed
  const sheet = await openZoneSheet(page)
  await sheet.getByRole('button', { name: /^ニューヨーク、/ }).click()
  await expect(sheet.getByText('ニューヨークに変更しています…')).toBeVisible()

  // Act: the sheet closes, then the pick lands, then the app starts again with the network back.
  await sheet.getByRole('button', { name: '閉じる' }).click()
  releasePick()
  await expect
    .poll(async () => (await api.settings.get()).timeZone)
    .toBe('America/New_York')
  // The landed pick counts as this device's sync of UTC; the store saves it a moment later.
  await expect.poll(async () => syncedZones(page)).toEqual(['UTC'])
  await page.unroute('**/api/rpc/settings/update')
  await page.reload()

  // Assert: the pick stands, since this device has nothing of its own left to write on start.
  await page.getByRole('tab', { name: '設定' }).click()
  await expect(
    page.getByText('ニューヨーク · この端末は 協定世界時'),
  ).toBeVisible()
  expect((await api.settings.get()).timeZone).toBe('America/New_York')
})

test('a pick that fails after the sheet closed shows the failure on 設定’s タイムゾーン row', async ({
  page,
}) => {
  // Arrange: the pick's write is held, then answered with a failure once the sheet has closed.
  await signUp(page)
  await expect.poll(async () => syncedZones(page)).toEqual(['Asia/Tokyo'])
  const api = await apiAs(page)
  let releaseWrite = (): void => undefined
  const writeHeld = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  await page.route('**/api/rpc/settings/update', async (route) => {
    await writeHeld
    await route
      .fulfill(rpcError('INTERNAL_SERVER_ERROR', 500))
      .catch(() => undefined)
  })
  const sheet = await openZoneSheet(page)
  await sheet.getByRole('button', { name: /^ニューヨーク、/ }).click()
  await sheet.getByRole('button', { name: '閉じる' }).click()

  // Act
  releaseWrite()

  // Assert
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: '保存できませんでした。もう一度お試しください' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'この端末に合わせる' }),
  ).toHaveCount(0)
  expect((await api.settings.get()).timeZone).toBe('Asia/Tokyo')
})

test('the タイムゾーン sheet keeps Tab inside, ignores Escape while a Japanese IME composes, and gives focus back to 設定’s row when it closes', async ({
  page,
}) => {
  // Arrange: the sheet is opened from the keyboard.
  await signUp(page)
  await page.getByRole('tab', { name: '設定' }).click()
  const row = page.getByRole('link', { name: 'タイムゾーン' })
  await row.focus()
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog', { name: 'タイムゾーン' })
  await expect(sheet).toBeFocused()
  const close = sheet.getByRole('button', { name: '閉じる' })
  const search = sheet.getByRole('textbox', { name: '都市・国名で検索' })

  // One row, so the list's last control stays put (the full list keeps rendering rows in batches).
  await search.fill('上海')
  const shanghai = sheet.getByRole('button', { name: /^上海、/ })
  await expect(shanghai).toBeEnabled()

  // Act & Assert: Shift+Tab on the first control wraps to the list's last row, and Tab from there wraps back.
  await close.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(shanghai).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()

  // Act & Assert: an Escape that ends an IME composition leaves the sheet open.
  await search.focus()
  await search.dispatchEvent('keydown', {
    key: 'Escape',
    isComposing: true,
    bubbles: true,
  })
  await expect(sheet).toBeVisible()

  // Act & Assert: a plain Escape closes it, and focus is back on the row that opened it.
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(row).toBeFocused()
})

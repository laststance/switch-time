import { expect, type Page, test } from '@playwright/test'

import { apiAs, signUp } from './helpers'

const readout = /^\d+:\d{2}:\d{2}$/

// The API seeds Asia/Tokyo, so fixtures are written in that zone (fixed +09:00, no DST), as in history.spec.ts.
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
    new Date(),
  )
const shift = (day: string, n: number) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10)
const at = (day: string, hour: number) =>
  new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+09:00`)
const idOf = (list: { id: string; name: string }[], name: string) => {
  const activity = list.find((row) => row.name === name)
  if (!activity) throw new Error(`no activity named ${name}`)
  return activity.id
}

test('the first launch screen disappears after the first switch', async ({
  page,
}) => {
  // Arrange
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page
    .getByLabel('メールアドレス')
    .fill(
      `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    )
  await page.getByLabel('パスワード').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  const firstLaunch = page.getByRole('heading', { name: 'いま何をしている？' })
  await expect(firstLaunch).toBeVisible()
  await expect(page.getByText(readout)).toHaveCount(0)

  // Act
  await page.getByRole('button', { name: '睡眠' }).click()

  // Assert
  await expect(firstLaunch).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'いま', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '睡眠' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText(readout)).toBeVisible()
  await expect(page.getByText(/^\d+:\d{2} から · 今日 0 回切替$/)).toBeVisible()
})

test('tapping 仕事 lights only 仕事, restarts the elapsed counter and fills the bar in its colour', async ({
  page,
}) => {
  // Arrange
  await signUp(page)
  await expect(page.getByRole('button', { name: '家事' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // Let 家事 run for a couple of seconds so a restart is observable.
  await expect(page.getByText(readout)).toHaveText(/^0:00:0[2-9]$/)

  // Act
  await page.getByRole('button', { name: '仕事' }).click()

  // Assert
  await expect(page.getByText(readout)).toHaveText(/^0:00:0[01]$/)
  await expect(page.getByRole('button', { name: '仕事' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: '家事' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(1)
  await expect(page.getByText(/今日 1 回切替$/)).toBeVisible()
  // 仕事's span fills with its colour, without the outline that detox and idle spans draw instead.
  const span = page
    .getByRole('img', { name: '今日の流れ' })
    .locator('div')
    .last()
  await expect(span).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  // RN-web gives every View a solid border style, so the missing outline shows as zero width.
  await expect(span).toHaveCSS('border-top-width', '0px')
})

test('tapping detox unpresses every activity, dims the readout and outlines the bar', async ({
  page,
}) => {
  // Arrange
  await signUp(page)
  const detox = page.getByRole('button', { name: /^detox/ })
  await expect(detox).toHaveAttribute('aria-pressed', 'false')

  // Act
  await detox.click()

  // Assert: the row is the only pressed switch, the hero has no colour of its own and the open span is outlined
  await expect(detox).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '家事' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(1)
  const subtext = page.getByText(
    /^\d+:\d{2} から · どの行動にも積み上がりません$/,
  )
  await expect(subtext).toBeVisible()
  // The theme follows the OS, so the dimmed readout is checked against the `sub` text next to it rather than a literal colour.
  const sub = await subtext.evaluate((el) => getComputedStyle(el).color)
  await expect(page.getByText(readout)).toHaveCSS('color', sub)
  // The open detox span is a solid `sub` outline: dashed is kept for idle spans, so the two differ by shape as well as tone.
  const span = page
    .getByRole('img', { name: '今日の流れ' })
    .locator('div')
    .last()
  await expect(span).toHaveCSS('border-top-style', 'solid')
  await expect(span).toHaveCSS('border-top-width', '1px')
  await expect(span).toHaveCSS('border-top-color', sub)
})

test('an activity left running past the idle threshold is dashed in line on the bar, unlike detox', async ({
  page,
}) => {
  // Arrange: 仕事 from 9:00 yesterday runs into today until the sign-up tap, past the 12 h idle threshold
  await signUp(page)
  const api = await apiAs(page)
  const yesterday = shift(today(), -1)
  const list = await api.activities.list()
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: idOf(list, '仕事'), startedAt: at(yesterday, 9) }],
  })

  // Act
  await page.reload()

  // Assert: the carried-in span is idle, dashed and not in the `sub` tone of the bar's own hour labels
  const span = page
    .getByRole('img', { name: '今日の流れ' })
    .locator('div')
    .first()
  await expect(span).toHaveCSS('border-top-style', 'dashed')
  const sub = await page
    .getByText('0:00', { exact: true })
    .evaluate((el) => getComputedStyle(el).color)
  await expect(span).not.toHaveCSS('border-top-color', sub)
})

test('a detox left running overnight stays a solid sub outline on the bar, not an idle dash', async ({
  page,
}) => {
  // Arrange: detox from 9:00 yesterday runs into today until the sign-up tap, past the 12 h idle threshold
  await signUp(page)
  const api = await apiAs(page)
  const yesterday = shift(today(), -1)
  await api.switches.replaceDay({
    day: yesterday,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: null, startedAt: at(yesterday, 9) }],
  })

  // Act
  await page.reload()

  // Assert: detox outranks idle, so the carried-in span keeps the detox outline in the `sub` tone of the hour labels, and its
  // left end follows the bar's curve so the rounded track does not clip the outline open at 0:00
  const span = page
    .getByRole('img', { name: '今日の流れ' })
    .locator('div')
    .first()
  await expect(span).not.toHaveCSS('border-top-left-radius', '0px')
  await expect(span).toHaveCSS('border-top-style', 'solid')
  await expect(span).toHaveCSS('border-top-width', '1px')
  const sub = await page
    .getByText('0:00', { exact: true })
    .evaluate((el) => getComputedStyle(el).color)
  await expect(span).toHaveCSS('border-top-color', sub)
})

test('digit 0 starts detox and a digit hands the clock back to an activity', async ({
  page,
}) => {
  // Arrange
  await signUp(page)
  const detox = page.getByRole('button', { name: /^detox/ })

  // Act
  await page.keyboard.press('0')
  await expect(detox).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('2')

  // Assert
  await expect(page.getByRole('button', { name: '仕事' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(detox).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(1)
  await expect(page.getByText(/今日 2 回切替$/)).toBeVisible()
})

test('narrow Home keeps the clock on screen and can scroll to the 24-h bar', async ({
  page,
}) => {
  // Arrange: a short phone frame — production Safari used to clip いま and the dial above the switch row
  await page.setViewportSize({ width: 390, height: 600 })
  await signUp(page)

  // Assert
  const heading = page.getByRole('heading', { name: 'いま', exact: true })
  const elapsed = page.getByLabel('経過時間')
  const bar = page.getByRole('img', { name: '今日の流れ' })
  await expect(heading).toBeVisible()
  await expect(heading).toBeInViewport()
  await expect(elapsed).toBeVisible()
  await expect(elapsed).toBeInViewport()
  await expect(bar).toBeVisible()
  await bar.scrollIntoViewIfNeeded()
  await expect(bar).toBeInViewport()
})

test('a reload while detox lands on Home in detox, not on the first-launch screen', async ({
  page,
}) => {
  // Arrange: detox written through the API, so the reload never races an optimistic tap
  await signUp(page)
  const api = await apiAs(page)
  await api.switches.switchTo({ activityId: null })

  // Act
  await page.reload()

  // Assert: Home mounts straight into detox once the activity list has answered, and the wide card's legend names it
  await expect(page.getByRole('button', { name: /^detox/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByText(/^\d+:\d{2} から · どの行動にも積み上がりません$/),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'いま何をしている？' }),
  ).toHaveCount(0)
  // The hero's name, the detox row's label and the 「今日の流れ」 legend entry: without the legend there would be two.
  await expect(page.getByText('detox', { exact: true })).toHaveCount(3)
  // The legend's square is drawn like the span it names: a solid outline in the `sub` tone of its label.
  const card = page
    .locator('div')
    .filter({ has: page.getByText('今日の流れ', { exact: true }) })
    .filter({ has: page.getByRole('img', { name: '今日の流れ' }) })
    .last()
  const label = card.getByText('detox', { exact: true })
  const square = label.locator('xpath=preceding-sibling::div[1]')
  await expect(square).toHaveCSS('border-top-style', 'solid')
  await expect(square).toHaveCSS('border-top-width', '1px')
  const sub = await label.evaluate((el) => getComputedStyle(el).color)
  await expect(square).toHaveCSS('border-top-color', sub)
})

// A detox started at 21:00 on `start` becomes the current state: signUp's first tap today is removed, so nothing ends it.
async function seedCarriedDetox(page: Page, start: string): Promise<void> {
  const api = await apiAs(page)
  await api.switches.replaceDay({
    day: start,
    timeZone: 'Asia/Tokyo',
    expected: [],
    rows: [{ activityId: null, startedAt: at(start, 21) }],
  })
  // replaceDay rewrites today only while it still holds the rows it names: the first-launch tap.
  const { rows: firstLaunch } = await api.switches.listByDay({ day: today() })
  await api.switches.replaceDay({
    day: today(),
    timeZone: 'Asia/Tokyo',
    expected: firstLaunch.map(({ id, activityId, startedAt }) => ({
      id,
      activityId,
      startedAt,
    })),
    rows: [],
  })
}

const monthDay = (day: string) =>
  `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`

test('a detox on the seventh day after it started names its start day and says nothing about counting', async ({
  page,
}) => {
  // Arrange: start day + 7 is the last untapped day a detox still measures
  await signUp(page)
  const start = shift(today(), -7)
  await seedCarriedDetox(page, start)
  const dayClassAnswer = page.waitForResponse((response) =>
    response.url().includes('/api/rpc/stats/day'),
  )

  // Act
  await page.reload()

  // Assert: the since line carries the date, and once the server answered for today there is no notice
  await expect(page.getByRole('button', { name: /^detox/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByText(
      `${monthDay(start)} 21:00 から · どの行動にも積み上がりません`,
      { exact: true },
    ),
  ).toBeVisible()
  expect((await dayClassAnswer).ok()).toBe(true)
  await expect(page.getByText('今日は計測に入りません')).toHaveCount(0)
})

test('a detox past its week says on Home that today does not count, until an activity is tapped', async ({
  page,
}) => {
  // Arrange: start day + 8 is the first untapped day the detox no longer measures
  await signUp(page)
  const start = shift(today(), -8)
  await seedCarriedDetox(page, start)
  await page.reload()
  await expect(page.getByRole('button', { name: /^detox/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const notice = page.getByText('今日は計測に入りません', { exact: true })
  await expect(notice).toBeVisible()
  await expect(
    page.getByText(
      'デトックスの計測は始めた翌日から7日間まで。今日中に行動へ切り替えると、今日も計測に入ります。',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    page.getByText(
      `${monthDay(start)} 21:00 から · どの行動にも積み上がりません`,
      { exact: true },
    ),
  ).toBeVisible()

  // Act
  await page.getByRole('button', { name: '仕事' }).click()

  // Assert: today now has a tap, so it is measured and the notice goes with the detox
  await expect(page.getByRole('button', { name: '仕事' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(notice).toHaveCount(0)
  await expect(page.getByText(/^\d+:\d{2} から · 今日 1 回切替$/)).toBeVisible()
})

import { expect, test } from '@playwright/test'

import { apiAs, signUp } from './helpers'

const readout = /^\d+:\d{2}:\d{2}$/

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

test('tapping 仕事 lights only 仕事 and restarts the elapsed counter', async ({
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
  await expect(
    page.locator('[role="button"][aria-pressed="true"]'),
  ).toHaveCount(1)
  await expect(page.getByText(/今日 1 回切替$/)).toBeVisible()
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
  await expect(
    page.locator('[role="button"][aria-pressed="true"]'),
  ).toHaveCount(1)
  const subtext = page.getByText(
    /^\d+:\d{2} から · どの行動にも積み上がりません$/,
  )
  await expect(subtext).toBeVisible()
  // The theme follows the OS, so the dimmed readout is checked against the `sub` text next to it rather than a literal colour.
  const sub = await subtext.evaluate((el) => getComputedStyle(el).color)
  await expect(page.getByText(readout)).toHaveCSS('color', sub)
  await expect(
    page.getByRole('img', { name: '今日の流れ' }).locator('div').last(),
  ).toHaveCSS('border-top-style', 'dashed')
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
  await expect(
    page.locator('[role="button"][aria-pressed="true"]'),
  ).toHaveCount(1)
  await expect(page.getByText(/今日 2 回切替$/)).toBeVisible()
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
})

import { expect, test } from '@playwright/test'

import { signUp } from './helpers'

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

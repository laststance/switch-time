import { expect, type Page, test } from '@playwright/test'

import { apiAs, createAccount, signUp } from './helpers'

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
  await createAccount(page)
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

test('a new account can start on detox from the first-launch screen, and a reload keeps it', async ({
  page,
}) => {
  // Arrange
  await createAccount(page)
  const firstLaunch = page.getByRole('heading', { name: 'いま何をしている？' })
  await expect(firstLaunch).toBeVisible()
  const detoxRow = page.getByRole('button', { name: /^detox/ })
  await expect(detoxRow).toHaveAttribute('aria-pressed', 'false')

  // Act: press detox before any activity, and wait for the server's answer so the reload reads the stored row
  const tapAnswer = page.waitForResponse((response) =>
    response.url().includes('/api/rpc/switches/switchTo'),
  )
  await detoxRow.click()
  expect((await tapAnswer).ok()).toBe(true)
  await page.reload()

  // Assert: Home in detox, no activity pressed, and the since line names no activity. The pressed row comes first: Home's
  // loading frame also has the いま heading and no first-launch heading, so only the row proves Home read the stored switch.
  await expect(page.getByRole('button', { name: /^detox/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(firstLaunch).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'いま', exact: true }),
  ).toBeVisible()
  // Only the detox row is pressed: no activity button took the first tap
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(1)
  await expect(
    page.getByText(/^\d+:\d{2} から · どの行動にも積み上がりません$/),
  ).toBeVisible()
})

test('a failed first detox tap brings the first-launch screen back instead of leaving Home in detox', async ({
  page,
}) => {
  // Arrange: hold the server's answer to the tap, so the optimistic Home can be seen before the failure arrives
  await createAccount(page)
  const firstLaunch = page.getByRole('heading', { name: 'いま何をしている？' })
  await expect(firstLaunch).toBeVisible()
  const tapAnswer = Promise.withResolvers<void>()
  let tapRequests = 0
  await page.route('**/api/rpc/switches/switchTo', async (route) => {
    tapRequests += 1
    await tapAnswer.promise
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        json: {
          defined: false,
          code: 'INTERNAL_SERVER_ERROR',
          status: 500,
          message: 'INTERNAL_SERVER_ERROR',
        },
      }),
    })
  })

  // Act
  await page.getByRole('button', { name: /^detox/ }).click()

  // Assert: Home shows detox at once, while the answer is still pending
  await expect(
    page.getByRole('heading', { name: 'いま', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^detox/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Act: the server refuses the tap, while the refetch of the current switch that follows is held, so only the rollback can
  // bring the first-launch screen back
  const currentAnswer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/current**', async (route) => {
    await currentAnswer.promise
    await route.continue()
  })
  tapAnswer.resolve()

  // Assert: the tap is rolled back to the first-launch screen, and the refused tap was sent once, not retried
  await expect(firstLaunch).toBeVisible()
  await expect(page.getByRole('button', { name: /^detox/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(tapRequests).toBe(1)
  currentAnswer.resolve()
})

test('two taps refused in a row keep the second on screen until its own answer, then bring the first-launch screen back', async ({
  page,
}) => {
  // Arrange: hold both taps' answers and every refetch of the current switch, so only the rollbacks change the screen
  await createAccount(page)
  const firstLaunch = page.getByRole('heading', { name: 'いま何をしている？' })
  await expect(firstLaunch).toBeVisible()
  const answers = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  let tapRequests = 0
  await page.route('**/api/rpc/switches/switchTo', async (route) => {
    const answer = answers[tapRequests]
    tapRequests += 1
    await answer?.promise
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        json: {
          defined: false,
          code: 'INTERNAL_SERVER_ERROR',
          status: 500,
          message: 'INTERNAL_SERVER_ERROR',
        },
      }),
    })
  })
  const currentAnswer = Promise.withResolvers<void>()
  await page.route('**/api/rpc/switches/current**', async (route) => {
    await currentAnswer.promise
    await route.continue()
  })
  await page.getByRole('button', { name: '仕事' }).click()
  await expect(page.getByRole('button', { name: '仕事' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '休息' }).click()
  await expect(page.getByRole('button', { name: '休息' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Act: the server refuses 仕事; 休息 then goes out
  answers[0]?.resolve()
  await expect.poll(() => tapRequests).toBe(2)

  // Assert: 休息 is still shown, with no flash of the first-launch screen from the refused 仕事
  await expect(page.getByRole('button', { name: '休息' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(firstLaunch).toHaveCount(0)

  // Act: the server refuses 休息 too
  answers[1]?.resolve()

  // Assert: back to the first-launch screen, never to the refused 仕事
  await expect(firstLaunch).toBeVisible()
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(0)
  expect(tapRequests).toBe(2)
  currentAnswer.resolve()
})

test('an accepted tap with a later tap still waiting leaves the later pick on screen instead of refetching over it', async ({
  page,
}) => {
  // Arrange: 家事 runs; 仕事 is tapped and held, then 休息 is tapped and queues behind it (both held until released)
  await signUp(page)
  await expect(page.getByRole('button', { name: '家事' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const answers = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  let tapRequests = 0
  await page.route('**/api/rpc/switches/switchTo', async (route) => {
    const answer = answers[tapRequests]
    tapRequests += 1
    await answer?.promise
    await route.continue()
  })
  await page.getByRole('button', { name: '仕事' }).click()
  await expect.poll(() => tapRequests).toBe(1)
  await page.getByRole('button', { name: '休息' }).click()
  await expect(page.getByRole('button', { name: '休息' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Act: the server takes 仕事; 休息 goes out only once 仕事 has settled
  answers[0]?.resolve()
  await expect.poll(() => tapRequests).toBe(2)

  // Assert: 仕事's answer did not refetch 仕事 over the waiting 休息
  await expect(page.getByRole('button', { name: '休息' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(1)

  // Act: 休息 lands
  answers[1]?.resolve()

  // Assert: the last tap's refetch counts both switches
  await expect(page.getByText(/今日 2 回切替$/)).toBeVisible()
  await expect(page.getByRole('button', { name: '休息' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('digit 0 on the first-launch screen starts a new account on detox', async ({
  page,
}) => {
  // Arrange
  await createAccount(page)
  const firstLaunch = page.getByRole('heading', { name: 'いま何をしている？' })
  await expect(firstLaunch).toBeVisible()

  // Act
  await page.keyboard.press('0')

  // Assert: Home in detox, as the detox row would have started it
  await expect(page.getByRole('button', { name: /^detox/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(firstLaunch).toHaveCount(0)
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(1)
  await expect(
    page.getByText(/^\d+:\d{2} から · どの行動にも積み上がりません$/),
  ).toBeVisible()
})

test('a digit on the first-launch screen starts the clock on the button at that position', async ({
  page,
}) => {
  // Arrange: the second button is 仕事
  await createAccount(page)
  const firstLaunch = page.getByRole('heading', { name: 'いま何をしている？' })
  await expect(firstLaunch).toBeVisible()

  // Act
  await page.keyboard.press('2')

  // Assert
  await expect(page.getByRole('button', { name: '仕事' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(firstLaunch).toHaveCount(0)
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(1)
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

test('two digits pressed within one frame leave the second one running', async ({
  page,
}) => {
  // Arrange: 家事 runs
  await signUp(page)
  const chores = page.getByRole('button', { name: '家事' })
  await expect(chores).toHaveAttribute('aria-pressed', 'true')

  // Act: `2` then `1` as two keydown tasks that both run before Home re-renders for the first
  await page.evaluate(async () => {
    const press = (key: string): boolean =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key }))
    press('2')
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        press('1')
        resolve()
      }, 0)
    })
  })

  // Assert: 家事 again, after 仕事 in between
  await expect(page.getByText(/今日 2 回切替$/)).toBeVisible()
  await expect(chores).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(1)
})

test('digits pressed while the correction sheet is open do not switch the activity behind it', async ({
  page,
}) => {
  // Arrange: 仕事 runs, and the correction sheet is open over Home
  await signUp(page)
  let tapRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('/api/rpc/switches/switchTo')) tapRequests += 1
  })
  await page.keyboard.press('2')
  const work = page.getByRole('button', { name: '仕事' })
  await expect(work).toHaveAttribute('aria-pressed', 'true')
  // The day list's refetch counts the press, so the switch has landed before the sheet opens.
  await expect(page.getByText(/今日 1 回切替$/)).toBeVisible()
  await page.getByRole('link', { name: '訂正' }).click()
  await expect(
    page.getByRole('dialog', { name: '今日の記録を訂正' }),
  ).toBeVisible()

  // Act
  await page.keyboard.press('3')
  await page.keyboard.press('0')
  await page.getByRole('button', { name: '完了' }).click()

  // Assert: back on Home, 仕事 still runs and only the first press reached the server
  await expect(page).toHaveURL('/')
  await expect(work).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/今日 1 回切替$/)).toBeVisible()
  expect(tapRequests).toBe(1)
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

test('a detox on the seventh day after it started warns that tomorrow will not count, without asking the server about today', async ({
  page,
}) => {
  // Arrange: start day + 7 is the last untapped day a detox still measures
  await signUp(page)
  const start = shift(today(), -7)
  await seedCarriedDetox(page, start)
  const dayClassRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/rpc/stats/day'))
      dayClassRequests.push(request.url())
  })
  // The gate reads the stored unused-day rule, so an empty list only means something once settings have answered
  const settingsAnswer = page.waitForResponse((response) =>
    response.url().includes('/api/rpc/settings/get'),
  )

  // Act
  await page.reload()
  await settingsAnswer

  // Assert: the since line carries the date; the last day's warning needs no server answer, so Home asks nothing about today
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
  await expect(
    page.getByText('明日から計測に入りません', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText(
      'デトックスの計測は始めた翌日から7日間まで。明日はデトックスを押し直すと、また7日間計測に入ります。',
      { exact: true },
    ),
  ).toBeVisible()
  // Inside its week a press still keeps the running record, so the detox row says nothing about starting over
  await expect(
    page.getByText('どの行動にも記録しない', { exact: true }),
  ).toBeVisible()
  // Every query the rendered screen enables has gone out and come back before the list is read
  await page.waitForLoadState('networkidle')
  expect(dayClassRequests).toEqual([])
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
      'デトックスの計測は始めた翌日から7日間まで。デトックスを押し直すか行動へ切り替えると、今日も計測に入ります。',
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

test('pressing detox again past its week starts a new run: the notice goes and the since line counts from the press', async ({
  page,
}) => {
  // Arrange: start day + 8, the first untapped day the detox no longer measures
  await signUp(page)
  const start = shift(today(), -8)
  await seedCarriedDetox(page, start)
  await page.reload()
  const detox = page.getByRole('button', { name: /^detox/ })
  await expect(detox).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByText('今日は計測に入りません', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('押し直すと新しく始まります', { exact: true }),
  ).toBeVisible()

  // Act: the optimistic row alone would pass the checks below, so wait for the server and read its answer after a reload
  const renewal = page.waitForResponse((response) =>
    response.url().includes('/api/rpc/switches/switchTo'),
  )
  await detox.click()
  expect((await renewal).ok()).toBe(true)
  await page.reload()

  // Assert: a new detox record runs from now (a bare time, no date), today is measured, and the row stays pressed
  await expect(
    page.getByText(/^\d+:\d{2} から · どの行動にも積み上がりません$/),
  ).toBeVisible()
  await expect(page.getByText('今日は計測に入りません')).toHaveCount(0)
  await expect(
    page.getByText('どの行動にも記録しない', { exact: true }),
  ).toBeVisible()
  await expect(detox).toHaveAttribute('aria-pressed', 'true')
})

test('a detox re-tap from a tab that missed the unused-day rule being turned off keeps the run and stops offering a new one', async ({
  page,
}) => {
  // Arrange: past the week with the rule on, then another device turns the rule off while this tab still offers a renewal
  await signUp(page)
  const start = shift(today(), -8)
  await seedCarriedDetox(page, start)
  await page.reload()
  const detox = page.getByRole('button', { name: /^detox/ })
  const renewHint = page.getByText('押し直すと新しく始まります', {
    exact: true,
  })
  await expect(renewHint).toBeVisible()
  const api = await apiAs(page)
  await api.settings.update({ autoExcludeUnusedDays: false })

  // Act
  const answer = page.waitForResponse((response) =>
    response.url().includes('/api/rpc/switches/switchTo'),
  )
  await detox.click()
  expect((await answer).ok()).toBe(true)

  // Assert: the server kept the carried-in run, and the tab has learned the rule is off
  await expect(
    page.getByText(
      `${monthDay(start)} 21:00 から · どの行動にも積み上がりません`,
      { exact: true },
    ),
  ).toBeVisible()
  await expect(renewHint).toHaveCount(0)
  await expect(
    page.getByText('どの行動にも記録しない', { exact: true }),
  ).toBeVisible()
  await expect(detox).toHaveAttribute('aria-pressed', 'true')
})

test('digit 0 past a detox’s week starts a new run, like pressing the detox row', async ({
  page,
}) => {
  // Arrange: start day + 8, the first untapped day the detox no longer measures
  await signUp(page)
  const start = shift(today(), -8)
  await seedCarriedDetox(page, start)
  await page.reload()
  await expect(
    page.getByText('今日は計測に入りません', { exact: true }),
  ).toBeVisible()

  // Act: wait for the server and read its answer after a reload, as the optimistic row alone would pass
  const renewal = page.waitForResponse((response) =>
    response.url().includes('/api/rpc/switches/switchTo'),
  )
  await page.keyboard.press('0')
  expect((await renewal).ok()).toBe(true)
  await page.reload()

  // Assert
  await expect(
    page.getByText(/^\d+:\d{2} から · どの行動にも積み上がりません$/),
  ).toBeVisible()
  await expect(page.getByText('今日は計測に入りません')).toHaveCount(0)
})

import { expect, type Page, test } from '@playwright/test'

import {
  createAccount,
  PASSWORD,
  register,
  REGISTERED_NOTICE,
  uniqueEmail,
} from './helpers'

const signOut = async (page: Page): Promise<void> => {
  await page.getByRole('tab', { name: '設定' }).click()
  await page.getByRole('button', { name: 'サインアウト' }).click()
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeVisible()
}

// The address field's top edge; it moves when the card above it grows or shrinks.
const addressTop = async (page: Page): Promise<number> => {
  const box = await page.getByLabel('メールアドレス').boundingBox()
  if (!box) throw new Error('the address field has no box')
  return box.y
}

test('a new user signs up, signs in with the address already filled in, and lands on the first-launch screen', async ({
  page,
}) => {
  // Arrange
  const email = uniqueEmail()
  await register(page, email)

  // Act
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(
    page.getByRole('heading', { name: 'いま何をしている？' }),
  ).toBeVisible()
  await expect(page).toHaveURL('/')
})

test('after sign-up the sign-in screen says the account was made, fills in the address and focuses the password', async ({
  page,
}) => {
  // Arrange
  const email = uniqueEmail()

  // Act
  await register(page, email)

  // Assert
  await expect(page).toHaveURL(/\/sign-in/)
  await expect(page.getByRole('status')).toHaveText(REGISTERED_NOTICE)
  await expect(page.getByLabel('メールアドレス')).toHaveValue(email)
  const password = page.getByLabel('パスワード')
  await expect(password).toHaveValue('')
  await expect(password).toBeFocused()
  // A screen reader lands on the focused password field and reads the notice with it.
  await expect(password).toHaveAccessibleDescription(REGISTERED_NOTICE)
})

test('typing the password after sign-up keeps the notice, the address and every typed character, and the card does not move', async ({
  page,
}) => {
  // Arrange
  const email = uniqueEmail()
  await register(page, email)
  const addressTopBefore = await addressTop(page)

  // Act: straight into the focused field, as a user would.
  await page.keyboard.type('corr')

  // Assert
  await expect(page.getByRole('status')).toHaveText(REGISTERED_NOTICE)
  await expect(page.getByLabel('パスワード')).toHaveValue('corr')
  await expect(page.getByLabel('メールアドレス')).toHaveValue(email)
  // Sub-pixel layout may differ; a moved card differs by whole pixels.
  expect(await addressTop(page)).toBeCloseTo(addressTopBefore, 0)
})

test('editing the address after sign-up hides the notice, which was about the address just registered, and keeps what was typed', async ({
  page,
}) => {
  // Arrange
  await register(page, uniqueEmail())
  await page.keyboard.type('corr')

  // Act
  await page.getByLabel('メールアドレス').fill('someone@example.com')

  // Assert
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByLabel('パスワード')).toHaveValue('corr')
  await expect(page.getByLabel('パスワード')).toHaveAccessibleDescription('')
})

test('coming back from sign-up without registering leaves the focus where the user put it', async ({
  page,
}) => {
  // Arrange: the password took the focus once after 登録; the user then moves to the address to fix it.
  await register(page, uniqueEmail())
  await page.getByLabel('メールアドレス').click()
  await page.getByRole('link', { name: '新規登録はこちら' }).click()
  await expect(page.getByLabel('名前')).toBeVisible()

  // Act
  await page.goBack()

  // Assert
  await expect(page.getByLabel('名前')).toBeHidden()
  await expect(page.getByLabel('パスワード')).not.toBeFocused()
})

test('signing up with an address that already has an account looks the same, and the original password still signs in', async ({
  page,
}) => {
  // Arrange
  const email = await createAccount(page)
  await signOut(page)

  // Act
  await register(page, email, 'a different password')
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(page).toHaveURL('/')
  await expect(
    page.getByRole('heading', { name: 'いま何をしている？' }),
  ).toBeVisible()
})

test('signing in after 登録 keeps the sent address on screen and the button off until the session lands', async ({
  page,
}) => {
  // Arrange: hold the session read Better Auth makes after the sign-in answer.
  const email = uniqueEmail()
  await register(page, email)
  await page.getByLabel('パスワード').fill(PASSWORD)
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/auth/get-session**', async (route) => {
    await held
    await route.continue()
  })
  const asked = page.waitForRequest('**/api/auth/get-session**')

  // Act
  await page.getByRole('button', { name: 'サインイン' }).click()
  await asked

  // Assert: the form the user sent is still there and cannot be sent twice; Home follows once the session lands.
  await expect(page.getByLabel('メールアドレス')).toHaveValue(email)
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeDisabled()
  release()
  await expect(
    page.getByRole('heading', { name: 'いま何をしている？' }),
  ).toBeVisible()
})

test('a sign-up left pending while the user registers another address does not replace that address when it answers late', async ({
  page,
}) => {
  // Arrange: the first address's sign-up hangs; the user goes to sign-in and registers a second address instead.
  const first = uniqueEmail()
  const second = uniqueEmail()
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/auth/sign-up/email', async (route) => {
    if (route.request().postDataJSON().email === first) await held
    await route.continue()
  })
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').fill(first)
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await page.getByRole('link', { name: 'サインインはこちら' }).click()
  await page.getByRole('link', { name: '新規登録はこちら' }).click()
  // The first sign-up and the sign-in it opened stay mounted (hidden) under the second sign-up.
  const shown = { visible: true }
  await page.getByLabel('名前').filter(shown).fill('E2E')
  await page.getByLabel('メールアドレス').filter(shown).fill(second)
  await page.getByLabel('パスワード').filter(shown).fill(PASSWORD)
  await page
    .getByRole('button', { name: 'アカウントを作成' })
    .filter(shown)
    .click()
  await expect(page.getByRole('status')).toHaveText(REGISTERED_NOTICE)
  await page.getByLabel('パスワード').filter(shown).fill('typed-so-far')
  const firstAnswer = page.waitForResponse('**/api/auth/sign-up/email')

  // Act
  release()
  await firstAnswer

  // Assert: sign-in still holds the second address and what the user typed.
  await expect(page.getByLabel('メールアドレス').filter(shown)).toHaveValue(
    second,
  )
  await expect(page.getByLabel('パスワード').filter(shown)).toHaveValue(
    'typed-so-far',
  )
})

test('a sign-up left pending while the user goes to sign in does not take over the sign-in form when it answers late', async ({
  page,
}) => {
  // Arrange: the sign-up hangs; the user goes to sign-in and starts typing an existing account's credentials.
  const pending = uniqueEmail()
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/auth/sign-up/email', async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').fill(pending)
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await page.getByRole('link', { name: 'サインインはこちら' }).click()
  // The sign-up stays mounted (hidden) under sign-in.
  const shown = { visible: true }
  await page
    .getByLabel('メールアドレス')
    .filter(shown)
    .fill('someone@example.com')
  await page.getByLabel('パスワード').filter(shown).fill('typed-so-far')
  const lateAnswer = page.waitForResponse('**/api/auth/sign-up/email')

  // Act
  release()
  await lateAnswer

  // Assert: sign-in keeps what the user typed and shows no registration notice.
  await expect(page.getByLabel('メールアドレス').filter(shown)).toHaveValue(
    'someone@example.com',
  )
  await expect(page.getByLabel('パスワード').filter(shown)).toHaveValue(
    'typed-so-far',
  )
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('a sign-up left pending while the user tries to sign in does not clear the sign-in error when it answers late', async ({
  page,
}) => {
  // Arrange: the sign-up hangs; the user goes to sign-in and sends a password that does not match.
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/auth/sign-up/email', async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').fill(uniqueEmail())
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await page.getByRole('link', { name: 'サインインはこちら' }).click()
  // The sign-up stays mounted (hidden) under sign-in.
  const shown = { visible: true }
  await page.getByLabel('メールアドレス').filter(shown).fill(uniqueEmail())
  await page.getByLabel('パスワード').filter(shown).fill('not the password')
  await page.getByRole('button', { name: 'サインイン' }).filter(shown).click()
  await expect(page.getByRole('alert')).toBeVisible()
  const lateAnswer = page.waitForResponse('**/api/auth/sign-up/email')

  // Act
  release()
  await lateAnswer

  // Assert: sign-in still shows its error and no registration notice.
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByLabel('パスワード').filter(shown)).toHaveValue(
    'not the password',
  )
})

test('a wrong password after sign-up replaces the notice with the sign-in error, in Japanese and in the notice’s own place', async ({
  page,
}) => {
  // Arrange
  await register(page, uniqueEmail())
  const addressTopBefore = await addressTop(page)

  // Act
  await page.getByLabel('パスワード').fill('not the password')
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(page.getByRole('alert')).toHaveText(
    'メールアドレスかパスワードが違います',
  )
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeVisible()
  // Sub-pixel layout may differ; a moved card differs by whole pixels.
  expect(await addressTop(page)).toBeCloseTo(addressTopBefore, 0)
})

test('a sign-in retried after an error keeps the error in its box, and the card in place, until the answer lands', async ({
  page,
}) => {
  // Arrange: the first try is refused at once, the second waits for the test to let it answer
  let answerRetry = (): void => {}
  const retryMayAnswer = new Promise<void>((resolve) => {
    answerRetry = resolve
  })
  let tries = 0
  await page.route('**/api/auth/sign-in/email', async (route) => {
    tries += 1
    if (tries === 2) await retryMayAnswer
    await route.fulfill({
      status: tries === 1 ? 401 : 500,
      contentType: 'application/json',
      body: JSON.stringify(
        tries === 1
          ? { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email' }
          : { message: 'Internal Server Error' },
      ),
    })
  })
  await page.goto('/sign-in')
  await page.getByLabel('メールアドレス').fill(uniqueEmail())
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'サインイン' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'メールアドレスかパスワードが違います',
  )
  const addressTopBefore = await addressTop(page)

  // Act
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert: while the retry is out, the first error stays and the card has not moved
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeDisabled()
  await expect(page.getByRole('alert')).toHaveText(
    'メールアドレスかパスワードが違います',
  )
  expect(await addressTop(page)).toBeCloseTo(addressTopBefore, 0)
  answerRetry()
  await expect(page.getByRole('alert')).toHaveText('もう一度お試しください')
  expect(await addressTop(page)).toBeCloseTo(addressTopBefore, 0)
})

test('a screen too short for the sign-in card still lets the button and the first field be reached on the web, where the scrolling card must not clip them', async ({
  page,
}) => {
  // Arrange: 300px is what a 375×667 phone has left above a 336pt keyboard (the native keyboard itself is checked on a simulator)
  await page.setViewportSize({ width: 375, height: 300 })
  await page.goto('/sign-in')
  const button = page.getByRole('button', { name: 'サインイン' })
  const address = page.getByLabel('メールアドレス')

  // Act
  await button.scrollIntoViewIfNeeded()

  // Assert
  await expect(button).toBeInViewport({ ratio: 0.9 })
  await address.scrollIntoViewIfNeeded()
  await expect(address).toBeInViewport({ ratio: 0.9 })
})

test('a sign-in the rate limit refuses asks to wait, in Japanese', async ({
  page,
}) => {
  // Arrange
  await page.route('**/api/auth/sign-in/email', async (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Too many requests. Please try again later.',
      }),
    }),
  )
  await page.goto('/sign-in')
  await page.getByLabel('メールアドレス').fill(uniqueEmail())
  await page.getByLabel('パスワード').fill(PASSWORD)

  // Act
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(page.getByRole('alert')).toHaveText(
    '短い間に何度も試されました。少し待ってからもう一度お試しください',
  )
})

test('a sign-up the server refuses says it could not register, in Japanese, and stays on sign-up', async ({
  page,
}) => {
  // Arrange
  await page.route('**/api/auth/sign-up/email', async (route) =>
    route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'FAILED_TO_CREATE_USER',
        message: 'Failed to create user',
      }),
    }),
  )
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').fill(uniqueEmail())
  await page.getByLabel('パスワード').fill(PASSWORD)

  // Act
  await page.getByRole('button', { name: 'アカウントを作成' }).click()

  // Assert
  await expect(page.getByRole('alert')).toHaveText(
    '登録できませんでした。もう一度お試しください',
  )
  await expect(page).toHaveURL(/\/sign-up/)
})

test('an error the app has no words for asks to try again instead of showing Better Auth’s English', async ({
  page,
}) => {
  // Arrange
  await page.route('**/api/auth/sign-in/email', async (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'SOMETHING_NEW',
        message: 'Something new went wrong',
      }),
    }),
  )
  await page.goto('/sign-in')
  await page.getByLabel('メールアドレス').fill(uniqueEmail())
  await page.getByLabel('パスワード').fill(PASSWORD)

  // Act
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(page.getByRole('alert')).toHaveText('もう一度お試しください')
})

test('submitting right after sign-up without a password keeps the notice, shows the field error and keeps the address', async ({
  page,
}) => {
  // Arrange
  const email = uniqueEmail()
  await register(page, email)

  // Act
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(
    page.getByText('パスワードは8文字以上にしてください'),
  ).toBeVisible()
  await expect(page.getByRole('status')).toHaveText(REGISTERED_NOTICE)
  await expect(page.getByLabel('メールアドレス')).toHaveValue(email)
  // The notice is still there, so the password field keeps pointing a screen reader at it.
  await expect(page.getByLabel('パスワード')).toHaveAccessibleDescription(
    REGISTERED_NOTICE,
  )
})

test('a second sign-up in the same tab refills sign-in with the new address and shows the notice again', async ({
  page,
}) => {
  // Arrange: the first registration's notice is dismissed by editing the address, as a user who changes their mind would.
  await register(page, uniqueEmail())
  await page.getByLabel('メールアドレス').fill('someone@example.com')
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.getByRole('link', { name: '新規登録はこちら' }).click()
  const second = uniqueEmail()
  // Sign-up is pushed over sign-in, which stays mounted (hidden) underneath.
  const signUpForm = { visible: true }

  // Act
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').filter(signUpForm).fill(second)
  await page.getByLabel('パスワード').filter(signUpForm).fill(PASSWORD)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()

  // Assert
  await expect(page.getByRole('status')).toHaveText(REGISTERED_NOTICE)
  await expect(page.getByLabel('メールアドレス')).toHaveValue(second)
  // Reached through the sign-in link, the refilled form was hidden under sign-up when it remounted: it still takes the focus.
  const password = page.getByLabel('パスワード')
  await expect(password).toHaveValue('')
  await expect(password).toBeFocused()
  await expect(password).toHaveAccessibleDescription(REGISTERED_NOTICE)
})

test('a sign-up that cannot reach the server stays on sign-up with an error and does not claim the account was made', async ({
  page,
}) => {
  // Arrange
  await page.route('**/api/auth/sign-up/email', async (route) => route.abort())
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').fill(uniqueEmail())
  await page.getByLabel('パスワード').fill(PASSWORD)

  // Act
  await page.getByRole('button', { name: 'アカウントを作成' }).click()

  // Assert
  await expect(page.getByRole('alert')).toHaveText('もう一度お試しください')
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page).toHaveURL(/\/sign-up/)
  await expect(
    page.getByRole('button', { name: 'アカウントを作成' }),
  ).toBeVisible()
})

test('signing out after sign-up and sign-in leaves sign-in blank, without the address or the notice', async ({
  page,
}) => {
  // Arrange
  await createAccount(page)

  // Act
  await signOut(page)

  // Assert: on a shared device, the next person does not see who registered here last.
  await expect(page.getByLabel('メールアドレス')).toHaveValue('')
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('signing out returns to sign-in and hides the app', async ({ page }) => {
  // Arrange
  await createAccount(page)

  // Act
  await signOut(page)

  // Assert
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'サインイン' })).toBeVisible()
  await expect(page.getByText('いま')).toHaveCount(0)
})

test('an existing account can sign back in after signing out', async ({
  page,
}) => {
  // Arrange
  const email = await createAccount(page)
  await signOut(page)

  // Act
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(page).toHaveURL('/')
  await expect(page.getByText('いま').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'サインイン' })).toHaveCount(0)
})

test('an anonymous visitor comes back to the exact URL they opened after signing in', async ({
  page,
  browser,
}) => {
  // Arrange: an account made in one browser; a fresh anonymous browser opens a deep link with a query.
  const email = await createAccount(page)
  const anonymous = await (await browser.newContext()).newPage()
  await anonymous.goto('/?tab=week')
  await expect(anonymous).toHaveURL(/\/sign-in\?next=/)

  // Act
  await anonymous.getByLabel('メールアドレス').fill(email)
  await anonymous.getByLabel('パスワード').fill(PASSWORD)
  await anonymous.getByRole('button', { name: 'サインイン' }).click()

  // Assert: the query survived the round trip through `next`.
  await expect(anonymous).toHaveURL('/?tab=week')
  await expect(anonymous.getByText('いま').first()).toBeVisible()
})

test('an anonymous visitor who signs up instead still comes back to the URL they opened', async ({
  page,
}) => {
  // Arrange
  await page.goto('/?tab=week')
  await expect(page).toHaveURL(/\/sign-in\?next=/)
  await page.getByRole('link', { name: '新規登録はこちら' }).click()
  // Sign-up is pushed over sign-in, which stays mounted (hidden) underneath.
  const signUpForm = { visible: true }
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').filter(signUpForm).fill(uniqueEmail())
  await page.getByLabel('パスワード').filter(signUpForm).fill(PASSWORD)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await expect(page.getByRole('status')).toHaveText(REGISTERED_NOTICE)

  // Act: no filter here: sign-up must have left the stack, so exactly one password field remains.
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(page).toHaveURL('/?tab=week')
})

test('a signed-in user opening sign-in while the session is still loading never sees the form before going home', async ({
  page,
}) => {
  // Arrange: hold the first session answer after a reload.
  await createAccount(page)
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/auth/get-session**', async (route) => {
    await held
    await route.continue()
  })

  // Act
  const asked = page.waitForRequest('**/api/auth/get-session**')
  await page.goto('/sign-in')
  await asked

  // Assert: the app is up and waiting on the held answer, not yet unrendered.
  await expect(page.getByLabel('パスワード')).toHaveCount(0)
  release()
  await expect(page).toHaveURL('/')
})

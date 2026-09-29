import { expect, type Page, test } from '@playwright/test'

import { PASSWORD, uniqueEmail } from './helpers'
import { linkIn, type MailSink, mailTo, startMailSink } from './mail-sink'

// This spec runs against the API that has a mail server (the `mail` project in playwright.config.ts): it mails a link to confirm an
// address and another to reset a password, and the sink below catches both.
const CONFIRM_SUBJECT = 'メールアドレスの確認'
const RESET_SUBJECT = 'パスワードの再設定'
const NEW_PASSWORD = 'a-brand-new-password'
// The screen the user came from stays mounted underneath (hidden), so its fields match a label too.
const shown = { visible: true }

let sink: MailSink
test.beforeAll(async () => {
  sink = await startMailSink(Number(process.env.E2E_SMTP_PORT))
})
test.afterAll(async () => {
  await sink.stop()
})

/** Registers `email` through the sign-up screen and stops on the sign-in screen it leads to. */
const signUpByMail = async (page: Page, email: string): Promise<void> => {
  await page.goto('/sign-up')
  await page.getByLabel('名前').fill('E2E')
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'アカウントを作成' }).click()
  await expect(page.getByRole('status')).toHaveText(
    '登録しました。確認メールのリンクを開いてから、サインインしてください',
  )
}

/** Registers a new address and opens the link the API mailed, so the address is confirmed; ends on sign-in with its notice. */
const confirmedAccount = async (page: Page): Promise<string> => {
  const email = uniqueEmail()
  await signUpByMail(page, email)
  await page.goto(linkIn(await mailTo(sink, email, CONFIRM_SUBJECT)))
  await expect(page.getByRole('status')).toHaveText(
    'メールアドレスを確認しました。サインインしてください',
  )
  return email
}

const signIn = async (
  page: Page,
  email: string,
  password: string,
): Promise<void> => {
  await page.getByLabel('メールアドレス').fill(email)
  await page.getByLabel('パスワード').fill(password)
  await page.getByRole('button', { name: 'サインイン' }).click()
}

test('a sign-in before the mailed link is opened is refused, and mails the link again', async ({
  page,
}) => {
  // Arrange
  const email = uniqueEmail()
  await signUpByMail(page, email)
  await mailTo(sink, email, CONFIRM_SUBJECT)

  // Act
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'サインイン' }).click()

  // Assert
  await expect(page.getByRole('alert')).toHaveText(
    'メールアドレスの確認がまだです。届いたメールのリンクを開いてください（確認メールを送り直しました）',
  )
  await mailTo(sink, email, CONFIRM_SUBJECT, 2)
})

test('opening the mailed link confirms the address and returns to sign-in with a notice, without signing in; sign-in then works', async ({
  page,
}) => {
  // Arrange
  const email = uniqueEmail()
  await signUpByMail(page, email)
  const link = linkIn(await mailTo(sink, email, CONFIRM_SUBJECT))

  // Act
  await page.goto(link)

  // Assert
  await expect(page).toHaveURL(/\/sign-in\?verified=1/)
  await expect(page.getByRole('status')).toHaveText(
    'メールアドレスを確認しました。サインインしてください',
  )
  await signIn(page, email, PASSWORD)
  await expect(
    page.getByRole('heading', { name: 'いま何をしている？' }),
  ).toBeVisible()
})

test('the link of a sign-in that mailed again also returns to the sign-in notice', async ({
  page,
}) => {
  // Arrange
  const email = uniqueEmail()
  await signUpByMail(page, email)
  await page.getByLabel('パスワード').fill(PASSWORD)
  await page.getByRole('button', { name: 'サインイン' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  const resent = await mailTo(sink, email, CONFIRM_SUBJECT, 2)

  // Act
  await page.goto(linkIn(resent))

  // Assert
  await expect(page).toHaveURL(/\/sign-in\?verified=1/)
  await expect(page.getByRole('status')).toHaveText(
    'メールアドレスを確認しました。サインインしてください',
  )
})

test('a forgotten password is reset from the mailed link, the link works once, and the new password signs in', async ({
  page,
}) => {
  // Arrange
  const email = await confirmedAccount(page)

  // Act: ask for the mail from sign-in's link
  await page.getByRole('link', { name: 'パスワードを忘れた方' }).click()
  await expect(page).toHaveURL(/\/forgot-password/)
  await page.getByLabel('メールアドレス').filter(shown).fill(email)
  await page.getByRole('button', { name: '再設定のメールを送る' }).click()

  // Assert
  await expect(page.getByRole('status')).toHaveText(
    '登録があれば、再設定のメールを送りました。届かないときは迷惑メールも見てください',
  )
  const link = linkIn(await mailTo(sink, email, RESET_SUBJECT))

  // Act: open the link and choose the new password
  await page.goto(link)
  await expect(page).toHaveURL(/\/reset-password\?token=/)
  await page.getByLabel('パスワード').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'パスワードを変える' }).click()

  // Assert
  await expect(page).toHaveURL(/\/sign-in\?reset=1/)
  await expect(page.getByRole('status')).toHaveText(
    'パスワードを変えました。新しいパスワードでサインインしてください',
  )

  // Act: the same link a second time is used up
  await page.goto(link)

  // Assert
  await expect(page.getByRole('alert')).toHaveText(
    'リンクの期限が切れています。もう一度、再設定のメールを送ってください',
  )

  // Act
  await page.goto('/sign-in')
  await signIn(page, email, NEW_PASSWORD)

  // Assert
  await expect(
    page.getByRole('heading', { name: 'いま何をしている？' }),
  ).toBeVisible()
})

test('the old password stops working once a new one is chosen', async ({
  page,
}) => {
  // Arrange
  const email = await confirmedAccount(page)
  await page.getByRole('link', { name: 'パスワードを忘れた方' }).click()
  await page.getByLabel('メールアドレス').filter(shown).fill(email)
  await page.getByRole('button', { name: '再設定のメールを送る' }).click()
  await page.goto(linkIn(await mailTo(sink, email, RESET_SUBJECT)))
  await page.getByLabel('パスワード').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'パスワードを変える' }).click()
  await expect(page).toHaveURL(/\/sign-in\?reset=1/)

  // Act
  await signIn(page, email, PASSWORD)

  // Assert
  await expect(page.getByRole('alert')).toHaveText(
    'メールアドレスかパスワードが違います',
  )
})

test('a reset link that arrives with an error says it expired and offers to ask again', async ({
  page,
}) => {
  // Act
  await page.goto('/reset-password?error=INVALID_TOKEN')

  // Assert
  await expect(page.getByRole('alert')).toHaveText(
    'リンクの期限が切れています。もう一度、再設定のメールを送ってください',
  )
  await page.getByRole('link', { name: '再設定のメールを送る' }).click()
  await expect(page).toHaveURL(/\/forgot-password/)
})

test('a confirmation link that no longer works returns to sign-in with the expired line', async ({
  page,
}) => {
  // Act
  await page.goto('/sign-in?error=invalid_token')

  // Assert
  await expect(page.getByRole('alert')).toHaveText(
    'リンクの期限が切れています。サインインすると、確認メールをもう一度お送りします',
  )
})

test('asking for a reset mail for an address with no account answers the same and sends nothing', async ({
  page,
}) => {
  // Arrange
  const stranger = uniqueEmail()
  const owner = await confirmedAccount(page)
  await page.goto('/forgot-password')

  // Act: the stranger asks first, then a real account does
  await page.getByLabel('メールアドレス').fill(stranger)
  await page.getByRole('button', { name: '再設定のメールを送る' }).click()

  // Assert: the same answer
  await expect(page.getByRole('status')).toHaveText(
    '登録があれば、再設定のメールを送りました。届かないときは迷惑メールも見てください',
  )
  await page.getByLabel('メールアドレス').fill(owner)
  await page.getByRole('button', { name: '再設定のメールを送る' }).click()
  // The API mails in the order it was asked, so once the owner's mail is in, the stranger's request has had its turn.
  await mailTo(sink, owner, RESET_SUBJECT)
  expect(sink.mails.some((mail) => mail.to === stranger)).toBe(false)
})

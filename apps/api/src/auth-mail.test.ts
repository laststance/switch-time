import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'

import { createAuth } from './auth'
import { env } from './env'
import type { Mail } from './mail-text'

// A spy left over from a failed assertion must not reach the next test.
afterEach(() => {
  vi.restoreAllMocks()
})

const PASSWORD = 'correct horse battery staple'
const AFTER_VERIFY = `${env.APP_ORIGIN}/sign-in?verified=1`
const AFTER_RESET = `${env.APP_ORIGIN}/reset-password`

/** An auth wired to a recorder instead of an SMTP server, and the mails it was asked to send. */
const withRecorder = () => {
  const sent: Mail[] = []
  const auth = createAuth({
    send: async (mail) => {
      sent.push(mail)
    },
  })
  const post = async (path: string, body: object) =>
    auth.handler(
      new Request(`http://localhost:${env.PORT}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  const signUp = async (email: string, password = PASSWORD) =>
    post('/sign-up/email', {
      name: 'Raphtalia',
      email,
      password,
      callbackURL: AFTER_VERIFY,
    })
  // No callbackURL, as the app sends it: with one, the client would redirect the browser after a successful sign-in.
  const signIn = async (email: string, password = PASSWORD) =>
    post('/sign-in/email', { email, password })
  return { auth, sent, post, signUp, signIn }
}

/** The field names of the `user` a sign-up answers with. */
const userKeys = async (response: Response): Promise<string[]> => {
  const { user } = z
    .object({ user: z.record(z.string(), z.unknown()) })
    .parse(await response.json())
  return Object.keys(user).sort()
}

/** The one link a mail carries. */
const linkIn = (mail: Mail | undefined): string => {
  const link = mail?.text.match(/https?:\/\/\S+/)?.[0]
  if (!link) throw new Error('the mail has no link')
  return link
}

test('a new sign-up mails a confirmation link to the address, and the answer still opens no session', async () => {
  // Arrange
  const { sent, signUp } = withRecorder()

  // Act
  const response = await signUp('new@example.com')

  // Assert
  expect(response.status).toBe(200)
  expect(response.headers.getSetCookie()).toEqual([])
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  expect(sent[0]).toMatchObject({
    to: 'new@example.com',
    subject: 'メールアドレスの確認 - Switch Time',
  })
  expect(linkIn(sent[0])).toContain('/api/auth/verify-email?token=')
})

test('sign-in with the right password is refused until the address is confirmed, and mails the link again', async () => {
  // Arrange
  const { sent, signUp, signIn } = withRecorder()
  await signUp('unconfirmed@example.com')
  await vi.waitFor(() => expect(sent).toHaveLength(1))

  // Act
  const response = await signIn('unconfirmed@example.com')

  // Assert
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
  expect(response.headers.getSetCookie()).toEqual([])
  await vi.waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[1]?.subject).toBe('メールアドレスの確認 - Switch Time')
})

test('the link a refused sign-in mails again lands on the sign-in notice, not on the API root', async () => {
  // Arrange
  const { auth, sent, signUp, signIn } = withRecorder()
  await signUp('resend@example.com')
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  await signIn('resend@example.com')
  await vi.waitFor(() => expect(sent).toHaveLength(2))

  // Act
  const opened = await auth.handler(new Request(linkIn(sent[1])))

  // Assert
  expect(opened.status).toBe(302)
  expect(opened.headers.get('location')).toBe(AFTER_VERIFY)
})

test('sign-in with a wrong password on an unconfirmed address says the password is wrong and sends no mail', async () => {
  // Arrange
  const { sent, signUp, signIn } = withRecorder()
  await signUp('wrong-password@example.com')
  await vi.waitFor(() => expect(sent).toHaveLength(1))

  // Act
  const response = await signIn(
    'wrong-password@example.com',
    'not the password',
  )

  // Assert: a stranger who guesses passwords learns nothing about the address and cannot make the owner's inbox fill up
  expect(response.status).toBe(401)
  expect(await response.json()).toMatchObject({
    code: 'INVALID_EMAIL_OR_PASSWORD',
  })
  expect(sent).toHaveLength(1)
})

test('opening the confirmation link confirms the address and sends the browser on, without signing anyone in; sign-in then works', async () => {
  // Arrange
  const { auth, sent, signUp, signIn } = withRecorder()
  await signUp('confirm@example.com')
  await vi.waitFor(() => expect(sent).toHaveLength(1))

  // Act
  const opened = await auth.handler(new Request(linkIn(sent[0])))
  const signedIn = await signIn('confirm@example.com')

  // Assert
  expect(opened.status).toBe(302)
  expect(opened.headers.get('location')).toBe(AFTER_VERIFY)
  expect(opened.headers.getSetCookie()).toEqual([])
  expect(signedIn.status).toBe(200)
  expect(signedIn.headers.getSetCookie().join(';')).toMatch(
    /better-auth\.session_token=/,
  )
})

test('a confirmation link that was tampered with sends the browser on with an error and confirms nothing', async () => {
  // Arrange
  const { auth, sent, signUp, signIn } = withRecorder()
  await signUp('tampered@example.com')
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  const spoiled = linkIn(sent[0]).replace(/token=[^&]+/, 'token=not-a-token')

  // Act
  const opened = await auth.handler(new Request(spoiled))
  const signedIn = await signIn('tampered@example.com')

  // Assert
  expect(opened.status).toBe(302)
  expect(opened.headers.get('location')).toContain('error=')
  expect(signedIn.status).toBe(403)
})

test('a sign-up for an address that already has an account answers like a new one and mails its owner a note instead of a link', async () => {
  // Arrange
  const { sent, signUp } = withRecorder()
  await signUp('owner@example.com')
  await vi.waitFor(() => expect(sent).toHaveLength(1))

  // Act
  const again = await signUp('owner@example.com', 'someone else entirely')
  const fresh = await signUp('unused@example.com')

  // Assert
  expect(again.status).toBe(fresh.status)
  expect(await userKeys(again)).toEqual(await userKeys(fresh))
  await vi.waitFor(() => expect(sent).toHaveLength(3))
  const notice = sent.find(
    (mail) =>
      mail.to === 'owner@example.com' &&
      mail.subject.startsWith('Switch Time への登録'),
  )
  expect(notice?.text).not.toMatch(/https?:\/\//)
  expect(sent.filter((mail) => mail.to === 'unused@example.com')).toHaveLength(
    1,
  )
})

test('a password reset request mails a link only to an address that has an account, and answers the same for both', async () => {
  // Arrange
  const { sent, post, signUp } = withRecorder()
  await signUp('forgot@example.com')
  await vi.waitFor(() => expect(sent).toHaveLength(1))

  // Act
  const known = await post('/request-password-reset', {
    email: 'forgot@example.com',
    redirectTo: AFTER_RESET,
  })
  const unknown = await post('/request-password-reset', {
    email: 'nobody@example.com',
    redirectTo: AFTER_RESET,
  })

  // Assert
  expect(known.status).toBe(200)
  expect(unknown.status).toBe(200)
  expect(await known.json()).toEqual(await unknown.json())
  await vi.waitFor(() => expect(sent).toHaveLength(2))
  expect(sent[1]).toMatchObject({
    to: 'forgot@example.com',
    subject: 'パスワードの再設定 - Switch Time',
  })
  expect(sent.some((mail) => mail.to === 'nobody@example.com')).toBe(false)
})

test('the reset link lands on the app with its token, the new password replaces the old one, and the old one stops working', async () => {
  // Arrange: a confirmed account that forgot its password
  const { auth, sent, post, signUp, signIn } = withRecorder()
  await signUp('reset@example.com')
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  await auth.handler(new Request(linkIn(sent[0])))
  await post('/request-password-reset', {
    email: 'reset@example.com',
    redirectTo: AFTER_RESET,
  })
  await vi.waitFor(() => expect(sent).toHaveLength(2))

  // Act
  const opened = await auth.handler(new Request(linkIn(sent[1])))
  const token = new URL(opened.headers.get('location') ?? '').searchParams.get(
    'token',
  )
  const changed = await post('/reset-password', {
    newPassword: 'a brand new password',
    token,
  })

  // Assert
  expect(opened.status).toBe(302)
  const landed = new URL(opened.headers.get('location') ?? '')
  expect(`${landed.origin}${landed.pathname}`).toBe(AFTER_RESET)
  expect(token).not.toBeNull()
  expect(changed.status).toBe(200)
  expect((await signIn('reset@example.com')).status).toBe(401)
  expect(
    (await signIn('reset@example.com', 'a brand new password')).status,
  ).toBe(200)
})

test('a used or spoiled reset link sends the browser to the app with an error and changes no password', async () => {
  // Arrange
  const { auth, sent, post, signUp, signIn } = withRecorder()
  await signUp('spoiled@example.com')
  await vi.waitFor(() => expect(sent).toHaveLength(1))
  await auth.handler(new Request(linkIn(sent[0])))
  await post('/request-password-reset', {
    email: 'spoiled@example.com',
    redirectTo: AFTER_RESET,
  })
  await vi.waitFor(() => expect(sent).toHaveLength(2))
  const spoiled = linkIn(sent[1]).replace(
    /reset-password\/[^?]+/,
    'reset-password/not-a-token',
  )

  // Act
  const opened = await auth.handler(new Request(spoiled))

  // Assert
  expect(opened.status).toBe(302)
  expect(opened.headers.get('location')).toMatch(/[?&]error=INVALID_TOKEN/)
  expect((await signIn('spoiled@example.com')).status).toBe(200)
})

test('a mail server that fails does not fail the sign-up or show in its answer', async () => {
  // Arrange
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const auth = createAuth({
    send: async () => {
      throw new Error('connection refused')
    },
  })

  // Act
  const response = await auth.handler(
    new Request(`http://localhost:${env.PORT}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Raphtalia',
        email: 'server-down@example.com',
        password: PASSWORD,
      }),
    }),
  )

  // Assert
  expect(response.status).toBe(200)
  await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())
  expect(String(consoleError.mock.calls[0]?.[1])).not.toContain('server-down')
})

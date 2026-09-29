import { createTransport } from 'nodemailer'

import { env } from './env'
import type { Mail } from './mail-text'

/** Whatever can carry a {@link Mail}: the SMTP server in production, a recorder in tests. */
export type Mailer = { send: (mail: Mail) => Promise<void> }

/**
 * A {@link Mailer} that hands mail to an SMTP server, the one place the API talks to mail. Built once from `SMTP_URL` and
 * `MAIL_FROM` ({@link mailer}); a message is sent when Better Auth asks for one.
 * @param smtpUrl - `smtp://` or `smtps://` with the login in the URL.
 * @param from - The sender, a bare address or `Name <address>`.
 * @returns The mailer.
 * @example await smtpMailer('smtps://u:p@smtp.example.com:465', 'Switch Time <no-reply@example.com>').send(mail)
 */
function smtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = createTransport(smtpUrl)
  return {
    send: async (mail): Promise<void> => {
      await transport.sendMail({ from, ...mail })
    },
  }
}

/**
 * Sends a mail without making the caller wait or fail. A slow mail server must not stretch a sign-up, and a mail that goes to an
 * address with no account (or fails) must not show in the answer: sign-up and password-reset answer the same either way.
 * Called by the Better Auth callbacks in {@link createAuth}.
 * @param mailer - Where to send it.
 * @param mail - What to send.
 * @example sendInBackground(mailer, verificationMail(user.email, url))
 */
export function sendInBackground(mailer: Mailer, mail: Mail): void {
  mailer.send(mail).catch((error: unknown) => {
    // The address and the link are not logged: both are private.
    console.error('mail not sent:', mail.subject, error)
  })
}

/** The API's mailer, or null when `SMTP_URL` and `MAIL_FROM` are not set (no verification, no password reset). */
export const mailer: Mailer | null =
  env.SMTP_URL && env.MAIL_FROM ? smtpMailer(env.SMTP_URL, env.MAIL_FROM) : null

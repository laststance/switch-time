import { expect } from '@playwright/test'
import { simpleParser } from 'mailparser'
import { SMTPServer } from 'smtp-server'

/** One mail the API handed to the sink. */
export type SunkMail = { to: string; subject: string; text: string }

/** A running sink: what it caught so far, and how to stop it. */
export type MailSink = {
  mails: SunkMail[]
  stop: () => Promise<void>
}

/**
 * Starts an SMTP server that keeps every mail in memory, so a test reads the link the API mailed. The mail API
 * (playwright.config.ts) points its `SMTP_URL` here; nothing leaves the machine. Started by the mail spec's `beforeAll`.
 * @param port - The port the mail API's `SMTP_URL` names.
 * @returns The sink, listening.
 * @example const sink = await startMailSink(4104)
 */
export async function startMailSink(port: number): Promise<MailSink> {
  const mails: SunkMail[] = []
  const server = new SMTPServer({
    authOptional: true,
    // Plain SMTP on localhost: without STARTTLS on offer, the API's transport does not try to upgrade.
    disabledCommands: ['STARTTLS', 'AUTH'],
    onData(stream, _session, done) {
      simpleParser(stream)
        .then((parsed) => {
          const recipient = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to
          mails.push({
            to: recipient?.value[0]?.address ?? '',
            subject: parsed.subject ?? '',
            text: parsed.text ?? '',
          })
          done()
        })
        .catch(done)
    },
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return {
    mails,
    stop: async (): Promise<void> =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

/**
 * Waits for the mail `to` gets with a subject that starts with `subject`, and hands back the latest one.
 * @param sink - The running {@link MailSink}.
 * @param to - The address the mail went to.
 * @param subject - The start of its subject.
 * @param count - How many such mails must have arrived (a second one after a resend).
 * @returns The latest matching mail.
 * @example const mail = await mailTo(sink, email, 'メールアドレスの確認')
 */
export async function mailTo(
  sink: MailSink,
  to: string,
  subject: string,
  count = 1,
): Promise<SunkMail> {
  const matching = (): SunkMail[] =>
    sink.mails.filter(
      (mail) => mail.to === to && mail.subject.startsWith(subject),
    )
  await expect.poll(() => matching().length).toBeGreaterThanOrEqual(count)
  const latest = matching().at(-1)
  if (!latest) throw new Error(`no mail to ${to} about ${subject}`)
  return latest
}

/**
 * The one link a mail carries.
 * @example const link = linkIn(mail) // 'http://localhost:4102/api/auth/verify-email?token=…'
 */
export function linkIn(mail: SunkMail): string {
  const link = mail.text.match(/https?:\/\/\S+/)?.[0]
  if (!link) throw new Error('the mail has no link')
  return link
}

/** A plain-text mail, before it is sent. */
export type Mail = { to: string; subject: string; text: string }

const IGNORE_IF_UNKNOWN = '心当たりがなければ、このメールは無視してください。'

/**
 * The mail that asks a new address to prove it is theirs. Sent when someone registers, and again when an address that has not
 * been confirmed yet tries to sign in. The words are the ones drawn on the pen board 「ST Phone / メール確認とパスワード再設定」.
 * @param to - The address to confirm.
 * @param url - The link Better Auth built (it carries the token and where to land afterwards).
 * @returns The mail, ready for {@link Mailer}.
 * @example verificationMail('a@example.com', 'https://app.example/api/auth/verify-email?token=t').subject // 'メールアドレスの確認 - Switch Time'
 */
export function verificationMail(to: string, url: string): Mail {
  return {
    to,
    subject: 'メールアドレスの確認 - Switch Time',
    text: `Switch Time に登録いただきありがとうございます。次のリンクを開いて、メールアドレスを確認してください。リンクは 1 時間で切れます。\n${url}\n${IGNORE_IF_UNKNOWN}\n`,
  }
}

/**
 * The mail that lets the owner of an address choose a new password. Sent only for an address that has an account.
 * @param to - The account's address.
 * @param url - The link Better Auth built (it carries the token; opening it lands on the app's reset screen).
 * @returns The mail, ready for {@link Mailer}.
 * @example resetMail('a@example.com', 'https://app.example/api/auth/reset-password/t').subject // 'パスワードの再設定 - Switch Time'
 */
export function resetMail(to: string, url: string): Mail {
  return {
    to,
    subject: 'パスワードの再設定 - Switch Time',
    text: `パスワードの再設定を受け付けました。次のリンクを開いて、新しいパスワードを決めてください。リンクは 1 時間で切れます。\n${url}\n${IGNORE_IF_UNKNOWN}パスワードは変わりません。\n`,
  }
}

/**
 * The note to the owner of an address that someone tried to register again. Better Auth answers that sign-up like a new one
 * (so the request tells nothing), and this mail is how the owner learns of it.
 * @param to - The existing account's address.
 * @returns The mail, ready for {@link Mailer}.
 * @example alreadyRegisteredMail('a@example.com').subject // 'Switch Time への登録がありました'
 */
export function alreadyRegisteredMail(to: string): Mail {
  return {
    to,
    subject: 'Switch Time への登録がありました',
    text: 'このメールアドレスで、Switch Time の新規登録がありました。すでにアカウントがあるため、新しくは作られていません。ご自身でなければ、何もしなくて大丈夫です。パスワードを忘れた場合は、サインイン画面の「パスワードを忘れた方」から再設定できます。\n',
  }
}

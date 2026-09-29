import { env } from './env'
import { type Mailer, sendInBackground } from './mail'
import { alreadyRegisteredMail, resetMail, verificationMail } from './mail-text'

/**
 * Makes a confirmation link land on the sign-in screen's 「確認しました」 notice when the request that asked for it named no landing.
 * Better Auth falls back to `/` then, which is the API's own root: a sign-in that mails the link again cannot name a landing
 * (its `callbackURL` would also make the client redirect after a successful sign-in), and sign-up from a client that sends none has the same gap.
 * Called by {@link mailAuthOptions} for every confirmation mail.
 * @param url - The link Better Auth built.
 * @param appOrigin - The app's origin (`APP_ORIGIN`).
 * @returns The same link, with the landing filled in only when Better Auth used its default.
 * @example landOnSignIn('https://api.example/api/auth/verify-email?token=t&callbackURL=%2F', 'https://app.example') // '…&callbackURL=https%3A%2F%2Fapp.example%2Fsign-in%3Fverified%3D1'
 */
function landOnSignIn(url: string, appOrigin: string): string {
  const link = new URL(url)
  if (link.searchParams.get('callbackURL') === '/')
    link.searchParams.set('callbackURL', `${appOrigin}/sign-in?verified=1`)
  return link.toString()
}

/**
 * What Better Auth needs to prove that an address belongs to its owner and to reset a password by mail. {@link createAuth}
 * adds it only when there is a {@link Mailer}; without one nothing here applies and sign-up works as before.
 * - Sign-in stays closed until the address is confirmed (`requireEmailVerification`); a new sign-up and every sign-in attempt
 *   with the right password on an unconfirmed address send the link (and the sign-in answers 403 EMAIL_NOT_VERIFIED).
 * - Opening the link confirms the address and does not sign anyone in.
 * - A sign-up for an address that already has an account mails its owner instead (the answer stays the same as for a new one).
 * @param mail - Where the mails go.
 * @returns The `emailAndPassword` and `emailVerification` parts to merge into Better Auth's options.
 * @example betterAuth({ emailAndPassword: { enabled: true, ...mailAuthOptions(mail).emailAndPassword } })
 */
export function mailAuthOptions(mail: Mailer) {
  return {
    emailAndPassword: {
      requireEmailVerification: true,
      // The reset mail goes out only for an address with an account, and the request answers the same for any address.
      sendResetPassword: async ({
        user,
        url,
      }: {
        user: { email: string }
        url: string
      }): Promise<void> => sendInBackground(mail, resetMail(user.email, url)),
      // Sessions opened with the old password end with it.
      revokeSessionsOnPasswordReset: true,
      onExistingUserSignUp: async ({
        user,
      }: {
        user: { email: string }
      }): Promise<void> =>
        sendInBackground(mail, alreadyRegisteredMail(user.email)),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({
        user,
        url,
      }: {
        user: { email: string }
        url: string
      }): Promise<void> =>
        sendInBackground(
          mail,
          verificationMail(user.email, landOnSignIn(url, env.APP_ORIGIN)),
        ),
    },
  }
}

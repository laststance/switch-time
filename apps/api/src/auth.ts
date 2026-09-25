import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'
import { expo } from '@better-auth/expo'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'

import { db } from './db/client'
import * as schema from './db/schema/auth'
import { seedUser } from './db/seed-user'
import { env } from './env'

// Postgres text refuses NUL. On sign-up that would fail only for an unused address (422) while a taken one answers 200,
// telling them apart in one request, so a NUL anywhere in the body is refused for both before Better Auth looks the address up.
const containsNul = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  Object.values(body).some(
    (value) => typeof value === 'string' && value.includes('\u0000'),
  )

export const auth = betterAuth({
  // One transaction per sign-up etc.: a failed second insert must not leave a user row without its account.
  database: drizzleAdapter(db, { provider: 'pg', schema, transaction: true }),
  secret: env.BETTER_AUTH_SECRET,
  // Where Better Auth itself is served (absolute links, callbacks, cookie flags): the API's own origin.
  // In production that is the web app's origin too (one origin behind App Platform ingress); locally the API is
  // :4100 while the Expo dev server on APP_ORIGIN (:4101) is only a trusted caller (see the dev CORS in app.ts).
  baseURL:
    env.NODE_ENV === 'production'
      ? env.APP_ORIGIN
      : `http://localhost:${env.PORT}`,
  trustedOrigins: [
    env.APP_ORIGIN,
    'switchtime://',
    // Expo Go serves the app from exp://<lan-ip>:4101 while developing.
    ...(env.NODE_ENV === 'development' ? ['exp://**'] : []),
  ],
  // No sign-in on sign-up: Better Auth then answers an address that already has an account like a new one (200, no session,
  // the password hashed anyway) instead of 422 USER_ALREADY_EXISTS, so the answer to one request no longer tells who has an account (its timing still can: TODOS.md).
  // Sign-up followed by sign-in still can: only proof of e-mail ownership (a mailer) closes that (TODOS.md).
  emailAndPassword: { enabled: true, autoSignIn: false },
  // Every account starts with the default activities and settings ({@link seedUser}).
  databaseHooks: {
    user: { create: { after: async (created) => seedUser(created.id) } },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-up/email' && containsNul(ctx.body))
        throw new APIError('BAD_REQUEST', { message: 'Invalid input' })
    }),
  },
  plugins: [expo()],
  // Rate limiting stays at its default (on in production only) and keys by client IP. App Platform's ingress puts the
  // client address in `do-connecting-ip` and its own hop in `x-forwarded-for` (Better Auth's default header), which
  // would otherwise fold every user into one shared bucket; without the header Better Auth logs a warning and falls back to that bucket.
  advanced: { ipAddress: { ipAddressHeaders: ['do-connecting-ip'] } },
})

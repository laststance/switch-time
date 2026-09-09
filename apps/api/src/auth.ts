import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'
import { expo } from '@better-auth/expo'
import { betterAuth } from 'better-auth'

import { db } from './db/client'
import * as schema from './db/schema/auth'
import { env } from './env'

export const auth = betterAuth({
  // One transaction per sign-up etc.: a failed second insert must not leave a user row without its account.
  database: drizzleAdapter(db, { provider: 'pg', schema, transaction: true }),
  secret: env.BETTER_AUTH_SECRET,
  // Where Better Auth itself is served (absolute links, callbacks, cookie flags): the API's own origin.
  // In production that is the web app's origin too (one origin behind App Platform ingress); locally the API is
  // :8080 while the Expo dev server on APP_ORIGIN (:8081) is only a trusted caller (see the dev CORS in app.ts).
  baseURL:
    env.NODE_ENV === 'production'
      ? env.APP_ORIGIN
      : `http://localhost:${env.PORT}`,
  trustedOrigins: [
    env.APP_ORIGIN,
    'switchtime://',
    // Expo Go serves the app from exp://<lan-ip>:8081 while developing.
    ...(env.NODE_ENV === 'development' ? ['exp://**'] : []),
  ],
  emailAndPassword: { enabled: true },
  plugins: [expo()],
  // Rate limiting stays at its default (on in production only) and keys by client IP. App Platform's ingress puts the
  // client address in `do-connecting-ip` and its own hop in `x-forwarded-for` (Better Auth's default header), which
  // would otherwise fold every user into one shared bucket; without the header Better Auth logs a warning and falls back to that bucket.
  advanced: { ipAddress: { ipAddressHeaders: ['do-connecting-ip'] } },
})

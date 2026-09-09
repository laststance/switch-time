import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'
import { expo } from '@better-auth/expo'
import { betterAuth } from 'better-auth'

import { db } from './db/client'
import * as schema from './db/schema/auth'
import { seedUser } from './db/seed-user'
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
  // Every account starts with the default activities and settings ({@link seedUser}).
  databaseHooks: {
    user: { create: { after: async (created) => seedUser(created.id) } },
  },
  plugins: [expo()],
  // Rate limiting stays at its default (on in production only). Behind App Platform it needs
  // `advanced.ipAddress.trustedProxies` / `ipAddressHeaders` to key by client IP instead of one shared bucket: MVP-09.
})

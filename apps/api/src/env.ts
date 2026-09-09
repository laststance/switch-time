import { z } from 'zod'

import { dbEnv } from './db/env'

// The server's variables on top of {@link dbEnv}, which already loaded `.env` and validated the database ones.
const serverEnv = z
  .object({
    PORT: z.coerce.number().int().positive().default(8080),
    // Origin of the web app: the Expo dev server locally, the same origin as the API in production.
    APP_ORIGIN: z.url().default('http://localhost:8081'),
    // `openssl rand -base64 32`; signs session cookies, so it must never change between deploys.
    BETTER_AUTH_SECRET: z.string().min(32),
  })
  // Better Auth derives the cookie `Secure` flag and the trusted origins from it: the localhost default must not leak into production.
  .refine(
    (values) =>
      dbEnv.NODE_ENV !== 'production' ||
      values.APP_ORIGIN.startsWith('https://'),
    {
      path: ['APP_ORIGIN'],
      message: 'must be an https:// origin when NODE_ENV=production',
    },
  )
  .parse(process.env)

export const env = { ...dbEnv, ...serverEnv }

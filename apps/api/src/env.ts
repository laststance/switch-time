import { z } from 'zod'

import { dbEnv } from './db/env'

// An empty value (`SMTP_URL=` in a compose file or `.env`) means the variable is not set.
const unlessEmpty = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

// The server's variables on top of {@link dbEnv}, which already loaded `.env` and validated the database ones.
const serverEnv = z
  .object({
    PORT: z.coerce.number().int().positive().default(4100),
    // Origin of the web app: the Expo dev server locally, the same origin as the API in production.
    APP_ORIGIN: z.url().default('http://localhost:4101'),
    // `openssl rand -base64 32`; signs session cookies, so it must never change between deploys.
    BETTER_AUTH_SECRET: z.string().min(32),
    // The mail server, e.g. `smtps://user:password@smtp.example.com:465`, and the sender shown to the reader. Both or neither: with
    // them the API asks for e-mail verification and offers a password reset; without them it works as before, with neither.
    SMTP_URL: unlessEmpty(z.url({ protocol: /^smtps?$/ })),
    MAIL_FROM: unlessEmpty(z.string().min(3)),
  })
  .refine((values) => Boolean(values.SMTP_URL) === Boolean(values.MAIL_FROM), {
    path: ['MAIL_FROM'],
    message: 'SMTP_URL and MAIL_FROM go together: set both or neither',
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

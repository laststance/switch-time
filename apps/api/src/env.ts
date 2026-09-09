import { existsSync } from 'node:fs'

import { z } from 'zod'

// Local convenience: pnpm scripts run from apps/api, so `../../.env` is the repo-root .env (see .env.example).
// Production injects real environment variables and has no such file. Existing variables are never overwritten.
if (existsSync('../../.env')) process.loadEnvFile('../../.env')

// Fail at boot on a bad environment: a misconfigured deploy must not become runtime 500s.
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(8080),
    // Origin of the web app: the Expo dev server locally, the same origin as the API in production.
    APP_ORIGIN: z.url().default('http://localhost:8081'),
    DATABASE_URL: z.url(),
    // PEM of the DigitalOcean Managed Databases CA; absent locally, where Compose Postgres speaks plain TCP.
    DATABASE_CA_CERT: z.string().optional(),
  })
  // Fail closed: a production process must never fall back to plain TCP because the CA went missing.
  .refine(
    (values) => values.NODE_ENV !== 'production' || values.DATABASE_CA_CERT,
    {
      path: ['DATABASE_CA_CERT'],
      message:
        'required when NODE_ENV=production (the database pool never falls back to plain TCP there)',
    },
  )

export const env = envSchema.parse(process.env)

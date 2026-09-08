import { existsSync } from 'node:fs'

import { z } from 'zod'

// Local convenience: pnpm scripts run from apps/api, so `../../.env` is the repo-root .env (see .env.example).
// Production injects real environment variables and has no such file. Existing variables are never overwritten.
if (existsSync('../../.env')) process.loadEnvFile('../../.env')

// Only what the pool needs, so `dist/db/migrate.js` (the PRE_DEPLOY job) boots without the server's variables;
// src/env.ts adds those. Fail at boot on a bad environment: a misconfigured deploy must not become runtime 500s.
export const dbEnv = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
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
  .parse(process.env)

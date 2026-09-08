import { z } from 'zod'

// Fail at boot on a bad environment: a misconfigured deploy must not become runtime 500s.
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  // Origin of the web app: the Expo dev server locally, the same origin as the API in production.
  APP_ORIGIN: z.url().default('http://localhost:8081'),
})

export const env = envSchema.parse(process.env)

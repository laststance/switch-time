import { defineConfig } from 'drizzle-kit'

import { env } from './src/env'

// generate → review the SQL under ./drizzle → migrate (src/db/migrate.ts). `drizzle-kit push` never touches prod.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*.ts',
  out: './drizzle',
  dbCredentials: { url: env.DATABASE_URL },
})

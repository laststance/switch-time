import { defineConfig } from 'drizzle-kit'

import { dbEnv } from './src/db/env'

// generate → review the SQL under ./drizzle → migrate (src/db/migrate.ts). `drizzle-kit push` never touches prod.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*.ts',
  out: './drizzle',
  dbCredentials: { url: dbEnv.DATABASE_URL },
})

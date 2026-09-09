import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { db, pool } from './client'

// The App Platform PRE_DEPLOY job runs exactly this file as `node dist/db/migrate.js` (MVP-09);
// `pnpm --filter api db:migrate` and the Vitest global setup run the same script.
// `../../drizzle` resolves from both src/db/ and dist/db/ to apps/api/drizzle.
try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  })
} finally {
  // Also on failure: an open pool keeps the Vitest global setup (same process) alive.
  await pool.end()
}

import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

import { pool } from './client'

// The App Platform PRE_DEPLOY job runs exactly this file as `node dist/db/migrate.js` (MVP-09);
// `pnpm --filter api db:migrate` and the Vitest global setup run the same script.
// `../../drizzle` resolves from both src/db/ and dist/db/ to apps/api/drizzle.
try {
  // On the pool itself, not `db`: a migration is no request, and an index build may take longer than a request's deadline.
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  })
} finally {
  // Also on failure: an open pool keeps the Vitest global setup (same process) alive.
  await pool.end()
}

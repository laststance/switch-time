import { execFileSync } from 'node:child_process'

import { expect, test } from 'vitest'

import { pool } from './client'

test('migration runner is idempotent against an already-migrated database', async () => {
  // Arrange — the global setup already ran src/db/migrate.ts once against this database.
  const before = await pool.query<{ count: number }>(
    'select count(*)::int as count from drizzle.__drizzle_migrations',
  )
  expect(before.rows[0]?.count).toBeGreaterThan(0)

  // Act — re-run the real script the PRE_DEPLOY job executes, as its own process.
  execFileSync(process.execPath, ['--import=tsx', 'src/db/migrate.ts'], {
    env: process.env,
  })

  // Assert — the log table exists and gained nothing from the re-run.
  const after = await pool.query(
    'select count(*)::int as count from drizzle.__drizzle_migrations',
  )
  expect(after.rows[0]).toEqual(before.rows[0])
})

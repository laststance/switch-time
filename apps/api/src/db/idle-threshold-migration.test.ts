import { readFileSync } from 'node:fs'

import type { PoolClient } from 'pg'
import { expect, test } from 'vitest'

import { pool } from './client'

// The migration file's own statements, in order. A copy here would drift from what deploy runs.
const migrationStatements = readFileSync(
  new URL(
    '../../drizzle/20260927054548_idle_threshold_16h/migration.sql',
    import.meta.url,
  ),
  'utf8',
)
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

/**
 * Runs the idle-threshold migration against a temporary `user_settings` that shadows the real table, then rolls back.
 * The live default may already be 960 once global setup has applied this migration, so the copy is set back to 720
 * first: the file's own `SET DEFAULT` and `UPDATE` have to move it. Called by the test below.
 * @param work - assertions, after the temporary table exists and before the migration statements run
 * @example await withShadowSettings(async (connection) => { await connection.query(migrationStatements[0]) })
 */
async function withShadowSettings(
  work: (connection: PoolClient) => Promise<void>,
): Promise<void> {
  const connection = await pool.connect()
  try {
    await connection.query('begin')
    await connection.query(
      'create temp table user_settings (like public.user_settings including defaults) on commit drop',
    )
    // The copied default follows the already-migrated database. Put the old 12 h default back so the file has to change it.
    await connection.query(
      'alter table user_settings alter column idle_threshold_minutes set default 720',
    )
    await work(connection)
  } finally {
    // Nothing the migration step did may outlive the test: the temporary table goes with the rollback.
    await connection.query('rollback')
    connection.release()
  }
}

test('accounts still on 12 hours move to 16 hours, and a chosen shorter or longer threshold stays', async () => {
  await withShadowSettings(async (connection) => {
    // Arrange: 720 is both the old default and the 12h button. 6h, 8h, 10h, a 15-minute custom value, 16h and 24h are choices.
    await connection.query(
      `insert into user_settings (user_id) values ('old-default')`,
    )
    await connection.query(
      `insert into user_settings (user_id, idle_threshold_minutes) values
         ('chose-6', 360),
         ('chose-8', 480),
         ('chose-10', 600),
         ('chose-12', 720),
         ('custom-15', 15),
         ('already-16', 960),
         ('chose-24', 1440)`,
    )
    const before = await connection.query<{ idle_threshold_minutes: number }>(
      `select idle_threshold_minutes from user_settings where user_id = 'old-default'`,
    )
    expect(before.rows[0]?.idle_threshold_minutes).toBe(720)

    // Act
    for (const statement of migrationStatements) {
      // Each breakpoint is one statement: the lock waits, the new default, the 720 update, then the waits handed back.
      await connection.query(statement)
    }
    await connection.query(
      `insert into user_settings (user_id) values ('fresh')`,
    )

    // Assert
    const { rows } = await connection.query<{
      user_id: string
      idle_threshold_minutes: number
    }>(
      'select user_id, idle_threshold_minutes from user_settings order by user_id',
    )
    expect(
      rows.map((row) => [row.user_id, row.idle_threshold_minutes]),
    ).toEqual([
      ['already-16', 960],
      ['chose-10', 600],
      ['chose-12', 960],
      ['chose-24', 1440],
      ['chose-6', 360],
      ['chose-8', 480],
      ['custom-15', 15],
      ['fresh', 960],
      ['old-default', 960],
    ])
  })
})

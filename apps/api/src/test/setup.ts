import { afterAll, beforeAll } from 'vitest'

import { pool } from '../db/client'

// Every test file starts from empty tables. Files share one database, so vitest.config.ts runs them serially.
beforeAll(async () => {
  const { rows } = await pool.query<{ tablename: string }>(
    "select quote_ident(tablename) as tablename from pg_tables where schemaname = 'public'",
  )
  // No tables until the first migration lands (MVP-05); TRUNCATE with an empty list is a syntax error.
  if (rows.length === 0) return
  const tables = rows.map((row) => row.tablename).join(', ')
  await pool.query(`truncate ${tables} restart identity cascade`)
})

afterAll(async () => pool.end())

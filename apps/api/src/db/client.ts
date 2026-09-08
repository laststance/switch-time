import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { dbEnv } from './env'
import { relations } from './relations'

// DO Managed Postgres only accepts TLS signed by its own CA; local Compose Postgres has no TLS at all.
// `pg` lets the connection string win over `ssl`, so DO's `?sslmode=require` would drop the CA: strip it.
const url = new URL(dbEnv.DATABASE_URL)
url.searchParams.delete('sslmode')

export const pool = new Pool({
  connectionString: url.href,
  ssl: dbEnv.DATABASE_CA_CERT ? { ca: dbEnv.DATABASE_CA_CERT } : false,
})

export const db = drizzle({ client: pool, relations })

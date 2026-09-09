import { existsSync } from 'node:fs'

import { defineConfig } from 'vitest/config'

// Tests run against the throwaway database; the API only ever reads DATABASE_URL,
// so it is swapped here, before any worker imports src/env.ts.
if (existsSync('../../.env')) process.loadEnvFile('../../.env')
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set (copy .env.example to .env)')
}
// setup.ts truncates every table in that database: never let it point at a real one.
if (!new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must name a database ending in _test')
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/test/global-setup.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // One shared database → one file at a time.
    fileParallelism: false,
  },
})

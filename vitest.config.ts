import { defineConfig } from 'vitest/config'

// Wallaby autoDetect starts at the repo root. `pnpm test` stays `pnpm -r test` (includes API).
export default defineConfig({
  test: {
    // API is omitted: its config throws without TEST_DATABASE_URL and a live *_test Postgres.
    projects: ['apps/app', 'packages/shared'],
  },
})

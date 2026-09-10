import { defineConfig, devices } from '@playwright/test'

// Web only. The API runs from its production bundle on :8080 and the exported site on :8081, which pipes `/api` to it
// (scripts/serve-spa.mts): one origin, the shape App Platform serves, so the export carries no API origin at all.
// Locally the Compose API on :8080 is reused; CI starts both cold (.github/workflows/test.yml).
export default defineConfig({
  testDir: 'e2e',
  // The API seeds Asia/Tokyo and the fixtures are written in it; pinned here so the app's zone sync does not move the account to
  // the runner's zone (UTC on GitHub).
  use: {
    baseURL: 'http://localhost:8081',
    timezoneId: 'Asia/Tokyo',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node ../api/dist/server.js',
      url: 'http://localhost:8080/api/healthz',
      reuseExistingServer: true,
    },
    {
      command: 'node scripts/serve-spa.mts 8081',
      url: 'http://localhost:8081',
      reuseExistingServer: true,
    },
  ],
})

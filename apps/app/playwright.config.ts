import { defineConfig, devices } from '@playwright/test'

// Web only. The API runs from its production bundle on :8080 and the exported site on :8081, which pipes `/api` to it
// (scripts/serve-spa.mts): one origin, the shape App Platform serves, so the export carries no API origin at all.
// Locally the Compose API on :8080 is reused; CI starts both cold (.github/workflows/test.yml). E2E_API_PORT / E2E_APP_PORT
// move both when another project holds the defaults on this machine (scripts/serve-spa.mts and e2e/helpers.ts read the same).
const apiPort = process.env.E2E_API_PORT ?? '8080'
const appPort = process.env.E2E_APP_PORT ?? '8081'
export default defineConfig({
  testDir: 'e2e',
  // The API seeds Asia/Tokyo and the fixtures are written in it; pinned here so the app's zone sync does not move the account to
  // the runner's zone (UTC on GitHub).
  use: {
    baseURL: `http://localhost:${appPort}`,
    timezoneId: 'Asia/Tokyo',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node ../api/dist/server.js',
      // Better Auth only trusts APP_ORIGIN, so the app port travels with the API port.
      env: { PORT: apiPort, APP_ORIGIN: `http://localhost:${appPort}` },
      url: `http://localhost:${apiPort}/api/healthz`,
      reuseExistingServer: true,
    },
    {
      command: `node scripts/serve-spa.mts ${appPort}`,
      url: `http://localhost:${appPort}`,
      reuseExistingServer: true,
    },
  ],
})

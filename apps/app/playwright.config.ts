import { defineConfig, devices } from '@playwright/test'

// Web only. The API runs from its production bundle on :4100 and the exported site on :4101, which pipes `/api` to it
// (scripts/serve-spa.mts): one origin, the shape App Platform serves, so the export carries no API origin at all.
// Locally the Compose API on :4100 is reused; CI starts both cold (.github/workflows/test.yml). E2E_API_PORT / E2E_APP_PORT
// move both when another project holds the defaults on this machine (scripts/serve-spa.mts and e2e/helpers.ts read the same).
// `||`, not `??`: an empty value passes the both-or-neither guard below and would otherwise build `http://localhost:/api`.
const apiPort = process.env.E2E_API_PORT || '4100'
const appPort = process.env.E2E_APP_PORT || '4101'
// Both or neither: `webServer.env` only reaches a server Playwright starts, and a reused Compose API keeps its own APP_ORIGIN
// (:4101), so a lone E2E_APP_PORT would fail every sign-up with Invalid origin.
if (Boolean(process.env.E2E_API_PORT) !== Boolean(process.env.E2E_APP_PORT))
  throw new Error('Set E2E_API_PORT and E2E_APP_PORT together, or neither')
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

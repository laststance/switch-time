import { defineConfig, devices } from '@playwright/test'

// Web only. The API runs from its production bundle on :8080 and the exported site on :8081 (the dev CORS origin).
// Locally the Compose API on :8080 is reused; CI starts both cold (.github/workflows/test.yml).
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:8081', ...devices['Desktop Chrome'] },
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

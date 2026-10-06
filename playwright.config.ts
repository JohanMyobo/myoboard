import { defineConfig, devices } from '@playwright/test'

const PORT = 4322

// Point CHROMIUM_PATH at an installed Chromium to skip Playwright's download
// (CI images, sandboxes); otherwise run `npx playwright install chromium` once.
const executablePath = process.env.CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: { executablePath },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && rm -rf .e2e-data && DATA_DIR=.e2e-data PORT=${PORT} npm run serve`,
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

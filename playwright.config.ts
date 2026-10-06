import { defineConfig, devices } from '@playwright/test'

const PORT = 4322
const ORIGIN = `http://127.0.0.1:${PORT}`

// The browser, in order of preference:
// - CHROMIUM_PATH: any Chromium binary (CI images, sandboxes);
// - PW_CHANNEL=chrome or msedge: the Google Chrome or Microsoft Edge already
//   installed (handy when a proxy blocks Playwright's browser download);
// - otherwise Playwright's own Chromium: `npx playwright install chromium` once.
const executablePath = process.env.CHROMIUM_PATH || undefined
const channel = process.env.PW_CHANNEL || undefined

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel,
    baseURL: ORIGIN,
    viewport: { width: 1280, height: 800 },
    launchOptions: { executablePath },
    trace: 'retain-on-failure',
  },
  webServer: {
    // Only node and npm, so the command runs the same in sh, cmd.exe and PowerShell.
    command: [
      `node -e "require('node:fs').rmSync('.e2e-data', { recursive: true, force: true })"`,
      'npm run build',
      `npm run serve -- --port ${PORT} --host 127.0.0.1 --data-dir .e2e-data`,
    ].join(' && '),
    url: `${ORIGIN}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

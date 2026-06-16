import { defineConfig, devices } from '@playwright/test'

const PORT = 3100
const TEST_DATABASE_URL = 'postgresql://dev:development@localhost:5332/db_test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'bun --bun vite dev --port 3100',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      // Auth must point at the test server's own origin so magic-link URLs and
      // passkey (WebAuthn) origin/rpID validation line up with the browser.
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? 'test-secret-please-change-at-least-32-chars',
      PASSKEY_RP_ID: 'localhost',
    },
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--no-sandbox'] },
      },
      dependencies: ['setup'],
    },
  ],
})

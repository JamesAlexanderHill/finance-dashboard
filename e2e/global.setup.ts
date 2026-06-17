import { test as setup } from '@playwright/test'
import { execSync } from 'node:child_process'
import { loginWithMagicLink, getSharedWorkspaceId } from './helpers'

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://dev:development@localhost:5332/db_test'
const AUTH_STATE = 'e2e/.auth/demo-user.json'

/**
 * Seeds the test database and signs in as a seeded demo user, persisting the
 * authenticated browser state for the smoke suite to reuse. Runs once, before
 * the chromium project (see playwright.config.ts `dependencies`).
 */
setup('seed database and authenticate', async ({ page, context }) => {
  setup.setTimeout(60_000)

  // Seed in a child process so the db singleton picks up the test DATABASE_URL.
  execSync('bun run scripts/seed-e2e.ts', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  })

  // Demo User A owns the shared workspace that holds the sample data.
  await loginWithMagicLink(page, 'demo-a@example.com')

  // Point the session at the shared workspace so the dashboard shows sample data.
  const workspaceId = await getSharedWorkspaceId()
  await context.addCookies([
    {
      name: 'fd_workspace_id',
      value: workspaceId,
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ])

  await context.storageState({ path: AUTH_STATE })
})

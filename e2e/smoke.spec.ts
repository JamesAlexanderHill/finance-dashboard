import { test, expect } from '@playwright/test'

/**
 * End-to-end smoke tests covering the core navigation and data flows.
 *
 * Runs authenticated as the seeded "Demo User A" (see global.setup.ts) against a
 * dedicated `db_test` Postgres database, viewing the shared "Joint Finances"
 * workspace that holds the sample data. Tests run serially.
 */
test.describe.configure({ mode: 'serial' })

// Reuse the authenticated, seeded browser state produced by the setup project.
test.use({ storageState: 'e2e/.auth/demo-user.json' })

test.describe('core flows', () => {
  test('dev tools page loads for an authenticated user', async ({ page }) => {
    await page.goto('/dev')
    await expect(page.getByRole('heading', { name: 'Dev Tools' })).toBeVisible()
  })

  test('dashboard shows net worth and account balance cards', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    // The net-worth card label, e.g. "Net Worth (AUD)" — distinct from the
    // "Net Worth History" chart heading.
    await expect(page.getByText(/Net Worth \(/)).toBeVisible()
    // CommBank appears as both an account card and a chart series — assert ≥1.
    await expect(page.getByText('CommBank').first()).toBeVisible()
  })

  test('account detail page shows instruments and recent events', async ({ page }) => {
    await page.goto('/accounts')
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await page.getByRole('row', { name: /CommBank/ }).click()

    await expect(page.getByRole('heading', { name: 'CommBank' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Instruments' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent Events' })).toBeVisible()
  })

  test('clicking an event opens the event drawer', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')
    await page.getByRole('row', { name: /CommBank/ }).click()
    await page.waitForLoadState('networkidle')

    // Click the first event row in the "Recent Events" table
    const eventsSection = page.locator('section', { has: page.getByRole('heading', { name: 'Recent Events' }) })
    await eventsSection.getByRole('row').nth(1).click()

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page).toHaveURL(/viewEvent=/)
  })

  test('categories page loads', async ({ page }) => {
    await page.goto('/categories')
    await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible()
  })
})

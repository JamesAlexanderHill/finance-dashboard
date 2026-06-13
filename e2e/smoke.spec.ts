import { test, expect } from '@playwright/test'

/**
 * End-to-end smoke tests covering the core navigation and data flows.
 *
 * Runs against a dedicated `db_test` Postgres database (see playwright.config.ts)
 * so "Clear all data" / "Seed base" on /dev never touch real data. Tests run
 * serially because each step depends on the database state left by the previous one.
 */
test.describe.configure({ mode: 'serial' })

test.describe('core flows', () => {
  test('dev tools: clear and seed demo data', async ({ page }) => {
    await page.goto('/dev')
    await expect(page.getByRole('heading', { name: 'Dev Tools' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const clearRow = page.locator('div', { has: page.getByRole('button', { name: 'Clear all data' }) }).last()
    await clearRow.getByRole('button', { name: 'Clear all data' }).click()
    await expect(clearRow.getByText('Done!')).toBeVisible()

    const seedBaseRow = page.locator('div', { has: page.getByRole('button', { name: 'Seed base' }) }).last()
    await seedBaseRow.getByRole('button', { name: 'Seed base' }).click()
    await expect(seedBaseRow.getByText('Done!')).toBeVisible()

    const seedEventsRow = page.locator('div', { has: page.getByRole('button', { name: 'Seed sample events' }) }).last()
    await seedEventsRow.getByRole('button', { name: 'Seed sample events' }).click()
    await expect(seedEventsRow.getByText('Done!')).toBeVisible()

    await page.reload()
    await expect(page.getByText('Demo User', { exact: true })).toBeVisible()
  })

  test('dashboard shows net worth and account balance cards', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByText(/Net Worth/)).toBeVisible()
    await expect(page.getByText('CommBank')).toBeVisible()
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

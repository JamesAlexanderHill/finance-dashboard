import { test, expect } from '@playwright/test'

/**
 * End-to-end tests for timeline annotations — vertical dotted lines on balance charts
 * with hover tooltips, per-annotation visibility toggles, and account CRUD UI.
 */
test.describe.configure({ mode: 'serial' })

test.use({ storageState: 'e2e/.auth/demo-user.json' })

test.describe('timeline annotations', () => {
  test('annotation lines appear on account balance chart', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')
    await page.getByRole('row', { name: /CommBank/ }).click()
    await page.waitForLoadState('networkidle')

    // Wait for the Balance History chart to be visible
    await expect(page.getByRole('heading', { name: 'Balance History' })).toBeVisible()

    // Annotation lines use strokeDasharray="3 3", distinct from data hover ("2 2") and zero/projected ("4 4")
    await expect(page.locator('svg line[stroke-dasharray="3 3"]').first()).toBeVisible()
  })

  test('unchecking an annotation toggle removes its lines from the chart', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')
    await page.getByRole('row', { name: /CommBank/ }).click()
    await page.waitForLoadState('networkidle')

    const before = await page.locator('svg line[stroke-dasharray="3 3"]').count()
    expect(before).toBeGreaterThan(0)

    // Uncheck the "Monthly rent" annotation toggle
    await page.getByLabel('Monthly rent').uncheck()

    const after = await page.locator('svg line[stroke-dasharray="3 3"]').count()
    // Monthly rent expands to multiple occurrences, so line count should decrease
    expect(after).toBeLessThan(before)
  })

  test('creating an annotation via the CRUD form adds it to the list', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')
    await page.getByRole('row', { name: /CommBank/ }).click()
    await page.waitForLoadState('networkidle')

    // Open the annotation form
    await page.getByRole('button', { name: '+ Add Annotation' }).click()

    await page.fill('input[name="label"]', 'Test Event E2E')
    await page.fill('input[name="date"]', '2026-03-01')
    await page.selectOption('select[name="recurrence"]', '')

    await page.getByRole('button', { name: 'Add' }).click()
    await page.waitForLoadState('networkidle')

    // The new annotation should appear in the annotations list
    await expect(page.getByText('Test Event E2E')).toBeVisible()
  })

  test('deleting an annotation removes it from the list', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')
    await page.getByRole('row', { name: /CommBank/ }).click()
    await page.waitForLoadState('networkidle')

    // Find "Test Event E2E" (created in the previous test) and delete it
    const annotationRow = page.locator('div', { has: page.getByText('Test Event E2E') })
    await annotationRow.getByRole('button', { name: 'Delete' }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Test Event E2E')).not.toBeVisible()
  })

  test('dashboard Net Worth History chart shows annotation lines from all accounts', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // The dashboard balance histogram is titled "Net Worth History"
    const histogramSection = page.locator('section', {
      has: page.getByRole('heading', { name: 'Net Worth History' }),
    })
    await expect(histogramSection).toBeVisible()

    // Annotation lines from CommBank and Vanguard accounts should appear
    await expect(histogramSection.locator('svg line[stroke-dasharray="3 3"]').first()).toBeVisible()
  })
})

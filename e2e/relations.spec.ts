import { test, expect } from '@playwright/test'

/**
 * End-to-end tests for transaction relations — linking events as internal
 * transfers, reimbursements, or refunds from the event drawer. The netting maths
 * is covered by unit tests (src/db/services/service/__tests__/relation-netting.test.ts);
 * here we exercise the drawer UI against the seeded sample data.
 */
test.use({ storageState: 'e2e/.auth/demo-user.json' })

test.describe('transaction relations', () => {
  test('event drawer shows a Relations section with a link picker', async ({ page }) => {
    await page.goto('/events')
    await page.waitForLoadState('networkidle')

    // Open the first event row → the drawer (dialog) opens.
    await page.getByRole('row').nth(1).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page).toHaveURL(/viewEvent=/)

    // The Relations section is present.
    await expect(page.getByRole('heading', { name: /Relations/ })).toBeVisible()

    // The link picker offers all three relation types and a search box.
    await page.getByRole('button', { name: /Link transaction/ }).click()
    await expect(page.getByPlaceholder(/Search description/)).toBeVisible()
    for (const type of ['transfer', 'reimbursement', 'refund']) {
      await expect(page.getByRole('button', { name: type, exact: true })).toBeVisible()
    }
  })

  test('a seeded internal transfer is shown and links both sides', async ({ page }) => {
    await page.goto('/events')
    await page.waitForLoadState('networkidle')

    // Open the Wise side of a seeded CommBank → Wise transfer (the inflow).
    await page.getByRole('row', { name: /Received from CommBank/ }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // The inflow is the child of the transfer, shown as "Transfer from".
    const incoming = page.getByRole('button', { name: /Transfer from/ })
    await expect(incoming).toBeVisible()

    // Clicking the relation switches the drawer to the CommBank outflow side,
    // which shows the reciprocal "Transfer to" relation.
    await incoming.click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: /Transfer to/ })).toBeVisible()
  })
})

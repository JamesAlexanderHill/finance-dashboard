import { test, expect, type Page } from '@playwright/test'
import { RANGE_PRESETS, addDays, addMonths, defaultBalanceHistoryRange, formatRange, startOfMonth, todayUTC, toISODate } from '../src/lib/date-range'

/**
 * End-to-end tests for the balance history chart's controls: the period
 * segmented control, view selector, and the merged range-highlighting
 * date-range picker/calendar.
 *
 * Runs against a dedicated `db_test` Postgres database (see playwright.config.ts),
 * seeded independently of e2e/smoke.spec.ts so this file can run standalone.
 */
test.describe.configure({ mode: 'serial' })

async function gotoAccount(page: Page, accountName: string) {
  await page.goto('/accounts')
  await page.waitForLoadState('networkidle')
  await page.getByRole('row', { name: new RegExp(accountName) }).click()
  await expect(page.getByRole('heading', { name: accountName, exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
}

function chartSection(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Balance History' }) })
}

test.describe('balance history chart controls', () => {
  test('dev tools: seed demo data', async ({ page }) => {
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
  })

  test('period selector offers Daily/Weekly/Monthly, no "Transactions" option', async ({ page }) => {
    await gotoAccount(page, 'CommBank')
    const chart = chartSection(page)
    await expect(chart).toBeVisible()

    await expect(chart.getByRole('button', { name: 'Daily', exact: true })).toBeVisible()
    await expect(chart.getByRole('button', { name: 'Weekly', exact: true })).toBeVisible()
    await expect(chart.getByRole('button', { name: 'Monthly', exact: true })).toBeVisible()
    await expect(chart.getByRole('button', { name: 'Transactions', exact: true })).toHaveCount(0)
  })

  test('date range trigger shows the default trailing-30-day range', async ({ page }) => {
    await gotoAccount(page, 'CommBank')
    const chart = chartSection(page)

    const expected = formatRange(defaultBalanceHistoryRange())
    await expect(chart.getByRole('button', { name: expected, exact: true })).toBeVisible()
  })

  test('date range popover lists every preset, and Cancel leaves the trigger unchanged', async ({ page }) => {
    await gotoAccount(page, 'CommBank')
    const chart = chartSection(page)

    const originalLabel = formatRange(defaultBalanceHistoryRange())
    const trigger = chart.getByRole('button', { name: originalLabel, exact: true })
    await trigger.click()

    for (const preset of RANGE_PRESETS) {
      await expect(page.getByRole('button', { name: preset.label, exact: true })).toBeVisible()
    }

    // Pick a different preset but back out via Cancel.
    await page.getByRole('button', { name: 'All time', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    await expect(chart.getByRole('button', { name: originalLabel, exact: true })).toBeVisible()
  })

  test('selecting "Last 7 days" and applying updates the trigger to that range', async ({ page }) => {
    await gotoAccount(page, 'CommBank')
    const chart = chartSection(page)

    const trigger = chart.getByRole('button', { name: formatRange(defaultBalanceHistoryRange()), exact: true })
    await trigger.click()

    await page.getByRole('button', { name: 'Last 7 days', exact: true }).click()

    const expectedRange = RANGE_PRESETS.find((p) => p.label === 'Last 7 days')!.range()
    const expectedLabel = formatRange(expectedRange)
    await expect(page.getByText(expectedLabel, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(chart.getByRole('button', { name: expectedLabel, exact: true })).toBeVisible()

    // "Last 7 days" spans exactly 6 days.
    expect(toISODate(addDays(expectedRange.start!, 6))).toBe(toISODate(expectedRange.end))
  })

  test('selecting "All time" and applying shows "All time – <today>"', async ({ page }) => {
    await gotoAccount(page, 'CommBank')
    const chart = chartSection(page)

    const trigger = chart.getByRole('button', { name: formatRange(defaultBalanceHistoryRange()), exact: true })
    await trigger.click()

    await page.getByRole('button', { name: 'All time', exact: true }).click()

    const expectedLabel = formatRange({ start: null, end: todayUTC() })
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(chart.getByRole('button', { name: expectedLabel, exact: true })).toBeVisible()
  })

  test('selecting a custom range via two day clicks on the calendar', async ({ page }) => {
    await gotoAccount(page, 'CommBank')
    const chart = chartSection(page)

    const trigger = chart.getByRole('button', { name: formatRange(defaultBalanceHistoryRange()), exact: true })
    await trigger.click()

    // Pin the calendar's visible month to the current month via the "This month" preset.
    await page.getByRole('button', { name: 'This month', exact: true }).click()

    const today = todayUTC()
    const firstOfMonth = startOfMonth(today)

    // Click the 1st of the month, then today — forward order: start then end.
    await page.getByRole('button', { name: toISODate(firstOfMonth), exact: true }).click()
    await page.getByRole('button', { name: toISODate(today), exact: true }).click()

    const expectedLabel = formatRange({ start: firstOfMonth, end: today })
    await expect(page.getByText(expectedLabel, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(chart.getByRole('button', { name: expectedLabel, exact: true })).toBeVisible()
  })

  test('selecting a custom range in reverse order swaps start/end', async ({ page }) => {
    await gotoAccount(page, 'CommBank')
    const chart = chartSection(page)

    const trigger = chart.getByRole('button', { name: formatRange(defaultBalanceHistoryRange()), exact: true })
    await trigger.click()

    await page.getByRole('button', { name: 'This month', exact: true }).click()

    const today = todayUTC()
    const firstOfMonth = startOfMonth(today)

    // Click today first, then the 1st of the month — reverse order: the
    // second (earlier) click should become the start, not the end.
    await page.getByRole('button', { name: toISODate(today), exact: true }).click()
    await page.getByRole('button', { name: toISODate(firstOfMonth), exact: true }).click()

    const expectedLabel = formatRange({ start: firstOfMonth, end: today })
    await expect(page.getByText(expectedLabel, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(chart.getByRole('button', { name: expectedLabel, exact: true })).toBeVisible()
  })

  test('"Previous month" navigation lets the user pick days outside the initial view', async ({ page }) => {
    await gotoAccount(page, 'CommBank')
    const chart = chartSection(page)

    const trigger = chart.getByRole('button', { name: formatRange(defaultBalanceHistoryRange()), exact: true })
    await trigger.click()

    // Pin to the current month, then navigate back one month.
    await page.getByRole('button', { name: 'This month', exact: true }).click()
    await page.getByRole('button', { name: 'Previous month', exact: true }).click()

    const prevMonthStart = addMonths(startOfMonth(todayUTC()), -1)
    const prevMonthFifth = addDays(prevMonthStart, 4)

    await page.getByRole('button', { name: toISODate(prevMonthStart), exact: true }).click()
    await page.getByRole('button', { name: toISODate(prevMonthFifth), exact: true }).click()

    const expectedLabel = formatRange({ start: prevMonthStart, end: prevMonthFifth })
    await expect(page.getByText(expectedLabel, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(chart.getByRole('button', { name: expectedLabel, exact: true })).toBeVisible()
  })

  test('Vanguard: multi-instrument toggles and Stacked Area view render', async ({ page }) => {
    await gotoAccount(page, 'Vanguard')
    const chart = chartSection(page)
    await expect(chart).toBeVisible()

    // Both instruments are shown and visible by default.
    const aud = chart.getByRole('checkbox', { name: 'AUD' })
    const vhy = chart.getByRole('checkbox', { name: 'VHY' })
    await expect(aud).toBeChecked()
    await expect(vhy).toBeChecked()
    await expect(chart.locator('svg').first()).toBeVisible()

    // Switch to the Stacked Area view.
    await chart.getByRole('combobox').click()
    await page.getByRole('option', { name: 'Stacked Area', exact: true }).click()
    await expect(chart.locator('svg').first()).toBeVisible()

    // Toggling an instrument off doesn't break the chart. The checkbox input
    // itself is visually hidden (sr-only); click its label text instead.
    await chart.getByText('VHY', { exact: true }).click()
    await expect(vhy).not.toBeChecked()
    await expect(chart.locator('svg').first()).toBeVisible()
  })
})
